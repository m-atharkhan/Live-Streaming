import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './Host.css';

// Connect to signaling server
const socket = io('http://localhost:5000');

function Host({ onReset }) {
  // State management
  const [roomId, setRoomId] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState([]);

  // Refs to store objects that shouldn't trigger re-renders
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const mediaRecorderRef = useRef(null);

  // WebRTC configuration
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Generate a random 6-character room code
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  // Start streaming function
  const startStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const newRoomId = generateRoomId();
      setRoomId(newRoomId);
      socket.emit('create-room', newRoomId);

      setIsStreaming(true);
      startRecording(stream);

    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Could not access camera/microphone. Please check permissions.');
    }
  };

  // Start recording the stream
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
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `stream-${roomId}-${Date.now()}.webm`;
        a.click();
        
        URL.revokeObjectURL(url);
        setRecordedChunks([]);
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      console.log('Recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not start recording');
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

  // Stop streaming and clean up
  const stopStream = () => {
    stopRecording();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};

    // Socket.io will handle disconnect automatically when component unmounts
    // No need to manually emit 'disconnect'

    setIsStreaming(false);
    setViewers([]);
    setRoomId('');
  };

  // Create peer connection for a new viewer
  const createPeerConnection = (viewerId) => {
    const peerConnection = new RTCPeerConnection(configuration);

    localStreamRef.current.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStreamRef.current);
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          to: viewerId
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state with ${viewerId}:`, peerConnection.connectionState);
    };

    peerConnectionsRef.current[viewerId] = peerConnection;

    return peerConnection;
  };

  // Setup socket event listeners
  useEffect(() => {
    socket.on('room-created', (data) => {
      console.log('Room created:', data.roomId);
    });

    socket.on('viewer-joined', async (data) => {
      console.log('Viewer joined:', data.viewerId);
      
      setViewers(prev => [...prev, data.viewerId]);

      const peerConnection = createPeerConnection(data.viewerId);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socket.emit('offer', {
        offer: offer,
        to: data.viewerId
      });
    });

    socket.on('answer', async (data) => {
      console.log('Received answer from:', data.from);
      
      const peerConnection = peerConnectionsRef.current[data.from];
      if (peerConnection) {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
      }
    });

    socket.on('ice-candidate', async (data) => {
      console.log('Received ICE candidate from:', data.from);
      
      const peerConnection = peerConnectionsRef.current[data.from];
      if (peerConnection && data.candidate) {
        await peerConnection.addIceCandidate(
          new RTCIceCandidate(data.candidate)
        );
      }
    });

    socket.on('viewer-left', (data) => {
      console.log('Viewer left:', data.viewerId);
      
      if (peerConnectionsRef.current[data.viewerId]) {
        peerConnectionsRef.current[data.viewerId].close();
        delete peerConnectionsRef.current[data.viewerId];
      }

      setViewers(prev => prev.filter(id => id !== data.viewerId));
    });

    return () => {
      socket.off('room-created');
      socket.off('viewer-joined');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('viewer-left');
    };
  }, []);

  // Copy room code to clipboard
  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room code copied to clipboard!');
  };

  return (
    <div className="host-container">
      <h2>Host Live Stream</h2>

      {!isStreaming ? (
        <div className="start-section">
          <p>Click the button below to start your live stream</p>
          <button className="start-button" onClick={startStream}>
            Start Streaming
          </button>
          <button className="back-button" onClick={onReset}>
            Back to Home
          </button>
        </div>
      ) : (
        <div className="streaming-section">
          <div className="room-code-box">
            <h3>Room Code:</h3>
            <div className="code-display">
              <span className="code">{roomId}</span>
              <button className="copy-button" onClick={copyRoomCode}>
                Copy Code
              </button>
            </div>
            <p className="instruction">Share this code with viewers to join your stream</p>
          </div>

          <div className="video-container">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video-preview"
            />
            <div className="video-label">Your Stream (Preview)</div>
            {isRecording && (
              <div className="recording-indicator">
                <span className="red-dot"></span> Recording
              </div>
            )}
          </div>

          <div className="viewers-info">
            <h3>Viewers: {viewers.length}</h3>
            {viewers.length > 0 && (
              <ul className="viewers-list">
                {viewers.map((viewerId, index) => (
                  <li key={viewerId}>Viewer {index + 1}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="controls">
            <button className="stop-button" onClick={stopStream}>
              Stop Streaming
            </button>
            <button className="back-button" onClick={() => {
              stopStream();
              onReset();
            }}>
              End & Go Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Host;