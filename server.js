const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let broadcaster;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('broadcaster', () => {
        broadcaster = socket.id;
        socket.broadcast.emit('broadcaster');
    });

    socket.on('watcher', () => {
        if (broadcaster) {
            socket.to(broadcaster).emit('watcher', socket.id);
        }
    });

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
        if (socket.id === broadcaster) {
            broadcaster = null;
            socket.broadcast.emit('broadcaster-disconnected');
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
