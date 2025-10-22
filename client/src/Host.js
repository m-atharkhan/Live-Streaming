// Host.js
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

  // New states (Bundle features)
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0); // seconds
  const [timerRunning, setTimerRunning] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [quality, setQuality] = useState('medium'); // low, medium, high
  const [recordFormat, setRecordFormat] = useState('video/webm;codecs=vp8,opus');
  const [useScreenShare, setUseScreenShare] = useState(false);

  // Refs
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);

  // WebRTC configuration
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Generate random room code
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  // Map quality to constraints
  const getConstraintsForQuality = (q) => {
    switch (q) {
      case 'low':
        return { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } };
      case 'high':
        return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      case 'medium':
      default:
        return { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20 } };
    }
  };

  // Start streaming (camera or screen + mic)
  const startStream = async () => {
    try {
      let stream = null;
      const constraints = {
        video: getConstraintsForQuality(quality),
        audio: true
      };

      if (useScreenShare && navigator.mediaDevices.getDisplayMedia) {
        // get screen stream (video)
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true
        });

        // get audio (microphone) separately to include mic
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // combine tracks
        stream = new MediaStream([
          ...screenStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
        ]);

        // When the user stops screen sharing, stop the stream and update state
        screenStream.getVideoTracks()[0].onended = () => {
          console.log('Screen share stopped by user');
          stopStream();
        };

      } else {
        // camera + mic with chosen quality
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Create room and notify server with password
      const newRoomId = generateRoomId();
      setRoomId(newRoomId);
      socket.emit('create-room', { roomId: newRoomId, password: roomPassword });

      setIsStreaming(true);
      startRecording(stream); // starts recording with selected format
      startTimer();
    } catch (error) {
      console.error('Error accessing media devices or starting stream:', error);
      alert('Could not start stream: ' + (error.message || error));
    }
  };

  // Start recording the stream with chosen format
  const startRecording = (stream) => {
    try {
      // check browser support for selected mime
      let options = { mimeType: recordFormat };
      if (!MediaRecorder.isTypeSupported(recordFormat)) {
        console.warn('Selected format not supported, falling back to default webm');
        options = {};
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `stream-${roomId}-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();

        URL.revokeObjectURL(url);
      };

      // record in 1s chunks
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      console.log('Recording started with format:', options.mimeType || 'default');
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not start recording: ' + (error.message || error));
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn('Error stopping recorder:', err);
      }
      setIsRecording(false);
      console.log('Recording stopped');
    }
  };

  // Stop streaming and cleanup
  const stopStream = () => {
    stopRecording();
    stopTimer();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    Object.values(peerConnectionsRef.current).forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    peerConnectionsRef.current = {};

    setIsStreaming(false);
    setViewers([]);
    setRoomId('');
    setIsMuted(false);
    setIsVideoOff(false);
    setDuration(0);
  };

  // Timer functions
  const startTimer = () => {
    setDuration(0);
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);
  };
  const stopTimer = () => {
    setTimerRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Toggle audio mute/unmute
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsMuted(prev => !prev);
  };

  // Toggle video on/off
  const toggleVideo = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsVideoOff(prev => !prev);
  };

  // Create peer connection for a new viewer
  const createPeerConnection = (viewerId) => {
    const peerConnection = new RTCPeerConnection(configuration);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

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
      // data: { viewerId, viewerName }
      console.log('Viewer joined:', data.viewerId, data.viewerName);

      setViewers(prev => [...prev, { id: data.viewerId, name: data.viewerName || 'Viewer' }]);

      // Create PC and send offer
      const peerConnection = createPeerConnection(data.viewerId);

      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('offer', {
          offer: offer,
          to: data.viewerId
        });
      } catch (err) {
        console.error('Error creating/sending offer:', err);
      }
    });

    socket.on('answer', async (data) => {
      console.log('Received answer from:', data.from);
      const peerConnection = peerConnectionsRef.current[data.from];
      if (peerConnection) {
        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
        } catch (err) {
          console.error('Error setting remote description:', err);
        }
      }
    });

    socket.on('ice-candidate', async (data) => {
      console.log('Received ICE candidate from:', data.from);
      const peerConnection = peerConnectionsRef.current[data.from];
      if (peerConnection && data.candidate) {
        try {
          await peerConnection.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    });

    socket.on('viewer-left', (data) => {
      console.log('Viewer left:', data.viewerId, data.viewerName);
      if (peerConnectionsRef.current[data.viewerId]) {
        try { peerConnectionsRef.current[data.viewerId].close(); } catch (e) {}
        delete peerConnectionsRef.current[data.viewerId];
      }
      setViewers(prev => prev.filter(v => v.id !== data.viewerId));
    });

    // Errors from server
    socket.on('error', (data) => {
      console.error('Server error:', data.message);
      alert(data.message);
    });

    return () => {
      socket.off('room-created');
      socket.off('viewer-joined');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('viewer-left');
      socket.off('error');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy room code to clipboard
  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room code copied to clipboard!');
  };

  // Picture-in-picture
  const openPictureInPicture = async () => {
    try {
      if (localVideoRef.current) {
        // video must be playing
        await localVideoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PiP error:', err);
      alert('Picture-in-Picture not available: ' + (err.message || err));
    }
  };

  // UI helpers: format duration
  const formatDuration = (s) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  return (
    <div className="host-container">
      <h2>Host Live Stream</h2>

      {!isStreaming ? (
        <div className="start-section">
          <p>Click the button below to start your live stream</p>

          <div style={{ marginBottom: 12 }}>
            <label style={{ marginRight: 8 }}>Room Password (optional):</label>
            <input
              type="text"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              placeholder="Set a password"
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ marginRight: 8 }}>Quality:</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="low">Low (320x240)</option>
              <option value="medium">Medium (640x480)</option>
              <option value="high">High (1280x720)</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ marginRight: 8 }}>Record format:</label>
            <select value={recordFormat} onChange={(e) => setRecordFormat(e.target.value)}>
              <option value="video/webm;codecs=vp8,opus">WebM VP8 + Opus (recommended)</option>
              <option value="video/webm;codecs=vp9,opus">WebM VP9 + Opus</option>
              <option value="video/mp4">MP4 (not supported widely in MediaRecorder)</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ marginRight: 8 }}>Use Screen Share:</label>
            <input type="checkbox" checked={useScreenShare} onChange={() => setUseScreenShare(v => !v)} />
          </div>

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
            {roomPassword && <p style={{ marginTop: 8 }}>🔒 Room is password protected</p>}
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

            <div style={{ position: 'absolute', bottom: 15, left: 15, background: 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: 8 }}>
              <strong>{formatDuration(duration)}</strong>
            </div>

            <div style={{ position: 'absolute', bottom: 15, right: 15, display: 'flex', gap: 8 }}>
              <button onClick={toggleMute} className="back-button">{isMuted ? 'Unmute' : 'Mute'}</button>
              <button onClick={toggleVideo} className="back-button">{isVideoOff ? 'Turn Video On' : 'Turn Video Off'}</button>
              <button onClick={openPictureInPicture} className="back-button">PiP</button>
            </div>

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
                {viewers.map((v, index) => (
                  <li key={v.id}>Viewer {index + 1}: {v.name}</li>
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
            <button className="back-button" onClick={() => {
              if (isRecording) stopRecording(); else startRecording(localStreamRef.current);
            }}>
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Host;
