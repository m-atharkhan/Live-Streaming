// Import required modules
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// Initialize Express app
const app = express();

// Enable CORS for all routes
app.use(cors());

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
const rooms = {};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle creating a new room (Host)
  socket.on('create-room', (roomId) => {
    console.log(`Room created: ${roomId} by ${socket.id}`);
    
    // Initialize room with host
    rooms[roomId] = {
      host: socket.id,
      viewers: []
    };
    
    // Join the socket to the room
    socket.join(roomId);
    
    // Store room info in socket for later use
    socket.roomId = roomId;
    socket.isHost = true;
    
    // Send success response
    socket.emit('room-created', { roomId });
  });

  // Handle joining an existing room (Viewer)
  socket.on('join-room', (roomId) => {
    console.log(`${socket.id} wants to join room: ${roomId}`);
    
    // Check if room exists
    if (!rooms[roomId]) {
      socket.emit('error', { message: 'Room does not exist' });
      return;
    }
    
    // Add viewer to room
    rooms[roomId].viewers.push(socket.id);
    socket.join(roomId);
    
    // Store room info in socket
    socket.roomId = roomId;
    socket.isHost = false;
    
    // Notify the host that a new viewer joined
    io.to(rooms[roomId].host).emit('viewer-joined', {
      viewerId: socket.id
    });
    
    // Send success response to viewer
    socket.emit('room-joined', { roomId });
  });

  // Handle WebRTC offer (from host to viewer)
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.to}`);
    
    // Forward the offer to the target peer
    io.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  // Handle WebRTC answer (from viewer to host)
  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.to}`);
    
    // Forward the answer to the target peer
    io.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  // Handle ICE candidates (for establishing connection)
  socket.on('ice-candidate', (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.to}`);
    
    // Forward ICE candidate to the target peer
    io.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
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
          id => id !== socket.id
        );
        
        // Notify host
        io.to(rooms[roomId].host).emit('viewer-left', {
          viewerId: socket.id
        });
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