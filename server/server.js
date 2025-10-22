// server.js
// Import required modules
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// Initialize Express app
const app = express();

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with CORS settings
const io = socketIO(server, {
  cors: {
    origin: "http://localhost:3000", // React app URL
    methods: ["GET", "POST"]
  }
});

// Store active rooms and their participants
// rooms = { roomId: { host: socketId, password: '...', viewers: [{id, name}] } }
const rooms = {};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle creating a new room (Host)
  socket.on('create-room', (data) => {
    // data: { roomId, password }
    try {
      const { roomId, password } = typeof data === 'string' ? { roomId: data, password: '' } : data;
      console.log(`Room created: ${roomId} by ${socket.id}`);

      // Initialize room with host and optional password
      rooms[roomId] = {
        host: socket.id,
        password: password || '',
        viewers: []
      };

      socket.join(roomId);
      socket.roomId = roomId;
      socket.isHost = true;

      // Send success response
      socket.emit('room-created', { roomId });

    } catch (err) {
      console.error('create-room error:', err);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // Handle joining an existing room (Viewer)
  socket.on('join-room', (data) => {
    // data: { roomId, name, password }
    try {
      const { roomId, name = 'Viewer', password = '' } = typeof data === 'string' ? { roomId: data, name: 'Viewer', password: '' } : data;
      console.log(`${socket.id} wants to join room: ${roomId} as ${name}`);

      // Check if room exists
      if (!rooms[roomId]) {
        socket.emit('error', { message: 'Room does not exist' });
        return;
      }

      // Check password
      if (rooms[roomId].password && rooms[roomId].password !== password) {
        socket.emit('error', { message: 'Incorrect room password' });
        return;
      }

      // Add viewer to room
      rooms[roomId].viewers.push({ id: socket.id, name });
      socket.join(roomId);
      socket.roomId = roomId;
      socket.isHost = false;
      socket.viewerName = name;

      // Notify the host that a new viewer joined (include viewer name)
      const hostId = rooms[roomId].host;
      io.to(hostId).emit('viewer-joined', {
        viewerId: socket.id,
        viewerName: name
      });

      // Send success response to viewer
      socket.emit('room-joined', { roomId });

    } catch (err) {
      console.error('join-room error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle WebRTC offer (from host to viewer)
  socket.on('offer', (data) => {
    // data: { offer, to }
    try {
      console.log(`Offer from ${socket.id} to ${data.to}`);
      io.to(data.to).emit('offer', {
        offer: data.offer,
        from: socket.id
      });
    } catch (err) {
      console.error('offer error:', err);
      socket.emit('error', { message: 'Failed to forward offer' });
    }
  });

  // Handle WebRTC answer (from viewer to host)
  socket.on('answer', (data) => {
    try {
      console.log(`Answer from ${socket.id} to ${data.to}`);
      io.to(data.to).emit('answer', {
        answer: data.answer,
        from: socket.id
      });
    } catch (err) {
      console.error('answer error:', err);
      socket.emit('error', { message: 'Failed to forward answer' });
    }
  });

  // Handle ICE candidates (for establishing connection)
  socket.on('ice-candidate', (data) => {
    try {
      console.log(`ICE candidate from ${socket.id} to ${data.to}`);
      io.to(data.to).emit('ice-candidate', {
        candidate: data.candidate,
        from: socket.id
      });
    } catch (err) {
      console.error('ice-candidate error:', err);
      socket.emit('error', { message: 'Failed to forward ICE candidate' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    const roomId = socket.roomId;

    if (roomId && rooms[roomId]) {
      // If host disconnects, notify all viewers and close room
      if (socket.isHost) {
        io.to(roomId).emit('host-disconnected');
        delete rooms[roomId];
        console.log(`Room ${roomId} closed`);
      } else {
        // If viewer disconnects, remove from viewers list
        rooms[roomId].viewers = rooms[roomId].viewers.filter(
          v => v.id !== socket.id
        );

        // Notify host (if still present)
        const hostId = rooms[roomId].host;
        if (hostId) {
          io.to(hostId).emit('viewer-left', {
            viewerId: socket.id,
            viewerName: socket.viewerName || ''
          });
        }
      }
    }
  });
});

// Simple route to check if server is running
app.get('/', (req, res) => {
  res.send('Live Streaming Signaling Server is running!');
});

// Start server on port 5000
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
