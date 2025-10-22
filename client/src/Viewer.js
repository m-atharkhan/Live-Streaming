// Viewer.js
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './Viewer.css';

// Connect to signaling server
const socket = io('http://localhost:5000');

function Viewer({ onReset }) {
  // State management
  const [roomId, setRoomId] = useState('');
  const [viewerName, setViewerName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  // Refs
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  // WebRTC configuration
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Join room function (sends name and password)
  const joinRoom = () => {
    if (!roomId.trim()) {
      setError('Please enter a room code');
      return;
    }
    // default name
    const nameToSend = viewerName.trim() || 'Viewer';
    setError('');
    socket.emit('join-room', { roomId: roomId.toUpperCase(), name: nameToSend, password: roomPassword });
  };

  // Create peer connection
  const createPeerConnection = () => {
    const peerConnection = new RTCPeerConnection(configuration);

    // Handle incoming stream tracks
    peerConnection.ontrack = (event) => {
      console.log('Received remote track');

      const stream = event.streams[0];
      remoteStreamRef.current = stream;

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }

      setIsConnected(true);
      startRecording(stream);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket.hostId) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          to: socket.hostId // host
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);

      if (peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed') {
        setIsConnected(false);
        stopRecording();
        alert('Connection lost with host');
      }
    };

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  };

  // Start recording the remote stream
  const startRecording = (stream) => {
    try {
      // viewer default format
      const options = { mimeType: 'video/webm;codecs=vp8,opus' };
      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `recorded-stream-${roomId}-${Date.now()}.webm`;
        a.click();

        URL.revokeObjectURL(url);
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      console.log('Viewer recording started');

    } catch (error) {
      console.error('Error starting viewer recording:', error);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
      setIsRecording(false);
      console.log('Viewer recording stopped');
    }
  };

  // Leave room and cleanup
  const leaveRoom = () => {
    stopRecording();

    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch (e) {}
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setIsJoined(false);
    setIsConnected(false);
    setRoomId('');
    setViewerName('');
    setRoomPassword('');
    setError('');
  };

  // Setup socket event listeners
  useEffect(() => {
    socket.on('room-joined', (data) => {
      console.log('Joined room:', data.roomId);
      setIsJoined(true);
      setError('');
    });

    socket.on('error', (data) => {
      console.error('Error:', data.message);
      setError(data.message);
      alert(data.message);
    });

    // Receiving offer from host
    socket.on('offer', async (data) => {
      console.log('Received offer from host');

      // store host id
      socket.hostId = data.from;

      // create pc
      const peerConnection = createPeerConnection();

      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data.offer)
        );

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', {
          answer: answer,
          to: data.from
        });

      } catch (err) {
        console.error('Error handling offer:', err);
        setError('Failed to process host offer');
      }
    });

    socket.on('ice-candidate', async (data) => {
      console.log('Received ICE candidate from host');

      if (peerConnectionRef.current && data.candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    });

    socket.on('host-disconnected', () => {
      console.log('Host disconnected');
      alert('The host has ended the stream');
      leaveRoom();
    });

    return () => {
      socket.off('room-joined');
      socket.off('error');
      socket.off('offer');
      socket.off('ice-candidate');
      socket.off('host-disconnected');
    };
  }, []);

  // Picture-in-picture for viewer
  const openPictureInPicture = async () => {
    try {
      if (remoteVideoRef.current) {
        await remoteVideoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('Viewer PiP error:', err);
      alert('Picture-in-Picture not available: ' + (err.message || err));
    }
  };

  return (
    <div className="viewer-container">
      <h2>Watch Live Stream</h2>

      {!isJoined ? (
        <div className="join-section">
          <p>Enter the room code to join a live stream</p>
          
          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Enter Room Code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
              maxLength={6}
              className="room-input"
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Your Name (optional)"
              value={viewerName}
              onChange={(e) => setViewerName(e.target.value)}
              className="room-input"
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <input
              type="password"
              placeholder="Room Password (if required)"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              className="room-input"
            />
          </div>

          <div className="input-group" style={{ gap: 8 }}>
            <button className="join-button" onClick={joinRoom}>
              Join Stream
            </button>
            <button className="back-button" onClick={onReset}>
              Back to Home
            </button>
          </div>

          {error && <p className="error-message">{error}</p>}
        </div>
      ) : (
        <div className="viewing-section">
          <div className="status-bar">
            <div className="status-info">
              <span className="room-badge">Room: {roomId}</span>
              {isConnected ? (
                <span className="status-badge connected">● Connected</span>
              ) : (
                <span className="status-badge connecting">● Connecting...</span>
              )}
            </div>
          </div>

          <div className="video-container">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="video-stream"
            />
            {!isConnected && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Waiting for host stream...</p>
              </div>
            )}
            {isRecording && (
              <div className="recording-indicator">
                <span className="red-dot"></span> Recording
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12 }}>
            <button className="leave-button" onClick={leaveRoom}>
              Leave Stream
            </button>
            <button className="back-button" onClick={() => { leaveRoom(); onReset(); }}>
              Leave & Go Home
            </button>
            <button className="back-button" onClick={openPictureInPicture}>
              PiP
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Viewer;
