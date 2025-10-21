import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './Viewer.css';

// Connect to signaling server
const socket = io('http://localhost:5000');

function Viewer({ onReset }) {
  // State management
  const [roomId, setRoomId] = useState('');
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

  // Join room function
  const joinRoom = () => {
    if (!roomId.trim()) {
      setError('Please enter a room code');
      return;
    }

    // Emit join-room event to server
    socket.emit('join-room', roomId.toUpperCase());
  };

  // Create peer connection
  const createPeerConnection = () => {
    const peerConnection = new RTCPeerConnection(configuration);

    // Handle incoming stream tracks
    peerConnection.ontrack = (event) => {
      console.log('Received remote track');
      
      // Get the remote stream
      const stream = event.streams[0];
      remoteStreamRef.current = stream;

      // Display in video element
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }

      setIsConnected(true);

      // Start recording automatically
      startRecording(stream);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          to: socket.hostId // Will be set when we receive offer
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
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8,opus'
      });

      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = `recorded-stream-${roomId}-${Date.now()}.webm`;
        a.click();
        
        // Clean up
        URL.revokeObjectURL(url);
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      console.log('Recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      console.log('Recording stopped');
    }
  };

  // Leave room and cleanup
  const leaveRoom = () => {
    stopRecording();

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // socket.emit('disconnect');

    setIsJoined(false);
    setIsConnected(false);
    setRoomId('');
    setError('');
  };

  // Setup socket event listeners
  useEffect(() => {
    // When successfully joined room
    socket.on('room-joined', (data) => {
      console.log('Joined room:', data.roomId);
      setIsJoined(true);
      setError('');
    });

    // When there's an error joining
    socket.on('error', (data) => {
      console.error('Error:', data.message);
      setError(data.message);
    });

    // When receiving offer from host
    socket.on('offer', async (data) => {
      console.log('Received offer from host');
      
      // Store host ID for later use
      socket.hostId = data.from;

      // Create peer connection
      const peerConnection = createPeerConnection();

      // Set remote description (the offer)
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.offer)
      );

      // Create answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send answer back to host
      socket.emit('answer', {
        answer: answer,
        to: data.from
      });
    });

    // When receiving ICE candidate from host
    socket.on('ice-candidate', async (data) => {
      console.log('Received ICE candidate from host');
      
      if (peerConnectionRef.current && data.candidate) {
        await peerConnectionRef.current.addIceCandidate(
          new RTCIceCandidate(data.candidate)
        );
      }
    });

    // When host disconnects
    socket.on('host-disconnected', () => {
      console.log('Host disconnected');
      alert('The host has ended the stream');
      leaveRoom();
    });

    // Cleanup on unmount
    return () => {
      socket.off('room-joined');
      socket.off('error');
      socket.off('offer');
      socket.off('ice-candidate');
      socket.off('host-disconnected');
    };
  }, []);

  return (
    <div className="viewer-container">
      <h2>Watch Live Stream</h2>

      {!isJoined ? (
        // Show join interface
        <div className="join-section">
          <p>Enter the room code to join a live stream</p>
          
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter Room Code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
              maxLength={6}
              className="room-input"
            />
            <button className="join-button" onClick={joinRoom}>
              Join Stream
            </button>
          </div>

          {error && <p className="error-message">{error}</p>}

          <button className="back-button" onClick={onReset}>
            Back to Home
          </button>
        </div>
      ) : (
        // Show viewing interface
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

          <div className="controls">
            <button className="leave-button" onClick={leaveRoom}>
              Leave Stream
            </button>
            <button className="back-button" onClick={() => {
              leaveRoom();
              onReset();
            }}>
              Leave & Go Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Viewer;