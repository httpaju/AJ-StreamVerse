const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files (HTML, JS, etc.)
app.use(express.static('public'));

// Socket.IO signaling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join a room for broadcasting
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        socket.broadcast.to(roomId).emit('user-connected', socket.id);
    });

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', { offer: data.offer, sender: socket.id });
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', { answer: data.answer, sender: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', data.candidate);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        socket.broadcast.emit('user-disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
