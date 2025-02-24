const socket = io();
const isBroadcastPage = window.location.pathname.includes('broadcast.html');
const isViewerPage = window.location.pathname.includes('viewer.html');
const isAdminPage = window.location.pathname.includes('admin.html');
let localStream;
let peerConnection;

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Broadcaster page logic
if (isBroadcastPage) {
    const localVideo = document.getElementById('localVideo');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const streamTitle = document.getElementById('streamTitle');
    const streamStatus = document.getElementById('streamStatus');
    const userCount = document.getElementById('userCount');
    const streamCount = document.getElementById('streamCount');

    startButton.onclick = async () => {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            socket.emit('broadcaster');
            startButton.disabled = true;
            stopButton.disabled = false;
            streamStatus.textContent = 'Live Now';
        } catch (err) {
            console.error('Error starting broadcast:', err);
        }
    };

    stopButton.onclick = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
            if (peerConnection) peerConnection.close();
            startButton.disabled = false;
            stopButton.disabled = true;
            streamStatus.textContent = 'Not Live';
        }
    };

    socket.on('watcher', (id) => {
        peerConnection = new RTCPeerConnection(config);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) socket.emit('ice-candidate', { target: id, candidate: event.candidate });
        };
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => socket.emit('offer', { offer: peerConnection.localDescription, target: id }));
    });

    socket.on('answer', (data) => {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    });

    socket.on('ice-candidate', (candidate) => {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('force-stop', () => {
        stopButton.click();
    });

    socket.on('update-users', (totalUsers, activeStreams) => {
        userCount.textContent = totalUsers;
        streamCount.textContent = activeStreams;
    });
}

// Viewer page logic
if (isViewerPage) {
    const remoteVideo = document.getElementById('remoteVideo');
    const streamTitle = document.getElementById('streamTitle');
    const streamStatus = document.getElementById('streamStatus');
    const userCount = document.getElementById('userCount');
    const streamCount = document.getElementById('streamCount');

    socket.on('connect', () => {
        socket.emit('watcher');
    });

    socket.on('broadcaster-available', () => {
        socket.emit('watcher');
    });

    socket.on('offer', async (data) => {
        peerConnection = new RTCPeerConnection(config);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        peerConnection.ontrack = (event) => {
            remoteVideo.srcObject = event.streams[0];
            streamTitle.textContent = 'Live Stream';
            streamStatus.textContent = 'Watching Live';
        };
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) socket.emit('ice-candidate', { target: data.sender, candidate: event.candidate });
        };
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { answer, target: data.sender });
    });

    socket.on('ice-candidate', (candidate) => {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('broadcaster-disconnected', () => {
        remoteVideo.srcObject = null;
        streamTitle.textContent = 'No Live Stream';
        streamStatus.textContent = 'Broadcaster disconnected';
        if (peerConnection) peerConnection.close();
    });

    socket.on('update-users', (totalUsers, activeStreams) => {
        userCount.textContent = totalUsers;
        streamCount.textContent = activeStreams;
    });
}

// Admin page logic
if (isAdminPage) {
    const adminUsername = document.getElementById('adminUsername');
    const adminPassword = document.getElementById('adminPassword');
    const loginButton = document.getElementById('loginButton');
    const loginStatus = document.getElementById('loginStatus');
    const userList = document.getElementById('userList');
    const stopStreamButton = document.getElementById('stopStreamButton');

    loginButton.onclick = () => {
        const credentials = {
            username: adminUsername.value,
            password: adminPassword.value
        };
        socket.emit('admin-login', credentials);
    };

    socket.on('admin-auth', (success) => {
        if (success) {
            loginStatus.textContent = 'Logged in as Admin';
            loginStatus.style.color = 'green';
            loginButton.disabled = true;
            adminUsername.disabled = true;
            adminPassword.disabled = true;
        } else {
            loginStatus.textContent = 'Invalid username or password';
            loginStatus.style.color = 'red';
        }
    });

    socket.on('user-list', (users, broadcasterId) => {
        userList.innerHTML = '';
        stopStreamButton.disabled = !broadcasterId;
        for (const [id, info] of Object.entries(users)) {
            const li = document.createElement('li');
            li.textContent = `${id} - ${info.role}${info.isBroadcaster ? ' (Broadcaster)' : ''}`;
            userList.appendChild(li);
            if (info.isBroadcaster) {
                stopStreamButton.onclick = () => socket.emit('stop-stream', id);
            }
        }
    });

    socket.on('update-users', (totalUsers, activeStreams) => {
        if (users[socket.id]?.role === 'admin') {
            socket.emit('admin-login', { username: adminUsername.value, password: adminPassword.value });
        }
    });
}
