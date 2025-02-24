const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let broadcaster = null;
let users = {}; // Store connected users
const admins = { 'ajmal': 'ajmal123' }; // Admin credentials

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    users[socket.id] = { role: 'viewer', isBroadcaster: false };

    socket.on('broadcaster', () => {
        if (!broadcaster) {
            broadcaster = socket.id;
            users[socket.id].role = 'broadcaster';
            users[socket.id].isBroadcaster = true;
            socket.broadcast.emit('broadcaster-available');
            io.emit('update-users', Object.keys(users).length, broadcaster ? 1 : 0);
        }
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

    socket.on('admin-login', ({ username, password }) => {
        if (admins[username] && admins[username] === password) {
            users[socket.id].role = 'admin';
            socket.emit('admin-auth', true);
            socket.emit('user-list', users, broadcaster);
        } else {
            socket.emit('admin-auth', false);
        }
    });

    socket.on('stop-stream', (targetId) => {
        if (users[socket.id].role === 'admin' && targetId === broadcaster) {
            socket.to(targetId).emit('force-stop');
            broadcaster = null;
            io.emit('broadcaster-disconnected');
            io.emit('update-users', Object.keys(users).length, 0);
        }
    });

    socket.on('disconnect', () => {
        if (socket.id === broadcaster) {
            broadcaster = null;
            socket.broadcast.emit('broadcaster-disconnected');
        }
        delete users[socket.id];
        io.emit('update-users', Object.keys(users).length, broadcaster ? 1 : 0);
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
