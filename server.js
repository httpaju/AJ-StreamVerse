const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 454804752264-0123c9jja9lgpqoo5laqfps29pt40cll.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Replace with your allowed broadcaster emails
const allowedBroadcasters = ['your.email@example.com', 'another.email@example.com'];

let broadcaster = null;
let users = {};
const admins = { 'adminUser': 'securePass123' };

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    users[socket.id] = { role: 'viewer', isBroadcaster: false, authenticated: false };

    socket.on('broadcaster-login', async ({ idToken }) => {
        try {
            const ticket = await client.verifyIdToken({
                idToken: idToken,
                audience: GOOGLE_CLIENT_ID
            });
            const payload = ticket.getPayload();
            const email = payload['email'];

            if (allowedBroadcasters.includes(email)) {
                users[socket.id].authenticated = true;
                socket.emit('broadcaster-auth', true);
                console.log('Broadcaster authenticated:', socket.id, email);
            } else {
                socket.emit('broadcaster-auth', false);
                console.log('Unauthorized broadcaster attempt:', socket.id, email);
            }
        } catch (err) {
            socket.emit('broadcaster-auth', false);
            console.error('Error verifying Google token:', err.message);
        }
    });

    socket.on('broadcaster', () => {
        if (!users[socket.id].authenticated) {
            socket.emit('broadcaster-auth-required');
            console.log('Authentication required for broadcaster:', socket.id);
            return;
        }
        if (!broadcaster) {
            broadcaster = socket.id;
            users[socket.id].role = 'broadcaster';
            users[socket.id].isBroadcaster = true;
            socket.broadcast.emit('broadcaster-available');
            io.emit('update-users', Object.keys(users).length, broadcaster ? 1 : 0);
            console.log('Broadcaster registered:', socket.id);
        } else {
            console.log('Broadcaster already exists; rejecting:', socket.id);
        }
    });

    socket.on('watcher', () => {
        if (broadcaster) {
            socket.to(broadcaster).emit('watcher', socket.id);
            console.log('Watcher', socket.id, 'sent to broadcaster:', broadcaster);
        } else {
            console.log('No broadcaster available for watcher:', socket.id);
            socket.emit('no-broadcaster');
        }
    });

    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', { offer: data.offer, sender: socket.id });
        console.log('Offer from', socket.id, 'to', data.target);
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', { answer: data.answer, sender: socket.id });
        console.log('Answer from', socket.id, 'to', data.target);
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', data.candidate);
        console.log('ICE candidate from', socket.id, 'to', data.target);
    });

    socket.on('admin-login', ({ username, password }) => {
        if (admins[username] && admins[username] === password) {
            users[socket.id].role = 'admin';
            socket.emit('admin-auth', true);
            socket.emit('user-list', users, broadcaster);
            console.log('Admin authenticated:', socket.id);
        } else {
            socket.emit('admin-auth', false);
            console.log('Admin authentication failed:', socket.id);
        }
    });

    socket.on('stop-stream', (targetId) => {
        if (users[socket.id].role === 'admin' && targetId === broadcaster) {
            socket.to(targetId).emit('force-stop');
            broadcaster = null;
            io.emit('broadcaster-disconnected');
            io.emit('update-users', Object.keys(users).length, 0);
            console.log('Admin stopped stream:', targetId);
        }
    });

    socket.on('disconnect', () => {
        if (socket.id === broadcaster) {
            broadcaster = null;
            socket.broadcast.emit('broadcaster-disconnected');
            console.log('Broadcaster disconnected:', socket.id);
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
