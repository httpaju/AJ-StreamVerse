const socket = io();
const isAdminPage = window.location.pathname.includes('admin.html');
let localStream;
let peerConnection;
let isBroadcaster = false;

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// User page logic
if (!isAdminPage) {
    const liveVideo = document.getElementById('liveVideo');
    const broadcastButton = document.getElementById('broadcastButton');
    const streamTitle = document.getElementById('streamTitle');
    const streamStatus = document.getElementById('streamStatus');
    const userCount = document.getElementById('userCount');
    const streamCount = document.getElementById('streamCount');
    const liveStreams = document.getElementById('liveStreams');

    broadcastButton.onclick = async () => {
        if (!isBroadcaster) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                liveVideo.srcObject = localStream;
                liveVideo.muted = true;
                socket.emit('broadcaster');
                isBroadcaster = true;
                broadcastButton.textContent = 'Stop Broadcasting';
                streamTitle.textContent = 'Your Live Stream';
                streamStatus.textContent = 'Live Now';
                liveStreams.innerHTML = '<p>Your Live Stream - Broadcasting</p>';
            } catch (err) {
                console.error('Error:', err);
            }
        } else {
            stopBroadcasting();
        }
    };

    function stopBroadcasting() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            liveVideo.srcObject = null;
            if (peerConnection) peerConnection.close();
            isBroadcaster = false;
            broadcastButton.textContent = 'Go Live';
            streamTitle.textContent = 'No Live Stream Active';
            streamStatus.textContent = 'Waiting for a broadcaster...';
            liveStreams.innerHTML = '';
        }
    }

    socket.on('connect', () => {
        if (!isBroadcaster) socket.emit('watcher');
    });

    socket.on('broadcaster', () => {
        if (!isBroadcaster) socket.emit('watcher');
    });

    socket.on('watcher', (id) => {
        if (isBroadcaster) {
            peerConnection = new RTCPeerConnection(config);
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) socket.emit('ice-candidate', { target: id, candidate: event.candidate });
            };
            peerConnection.createOffer()
                .then(offer => peerConnection.setLocalDescription(offer))
                .then(() => socket.emit('offer', { offer: peerConnection.localDescription, target: id }));
        }
    });

    socket.on('offer', async (data) => {
        if (!isBroadcaster) {
            peerConnection = new RTCPeerConnection(config);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            peerConnection.ontrack = (event) => {
                liveVideo.srcObject = event.streams[0];
                streamTitle.textContent = 'Live Stream';
                streamStatus.textContent = 'Watching Live';
                liveStreams.innerHTML = '<p>Live Stream - Watching</p>';
            };
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) socket.emit('ice-candidate', { target: data.sender, candidate: event.candidate });
            };
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', { answer, target: data.sender });
        }
    });

    socket.on('answer', (data) => {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    });

    socket.on('ice-candidate', (candidate) => {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('broadcaster-disconnected', () => {
        if (!isBroadcaster) {
            liveVideo.srcObject = null;
            streamTitle.textContent = 'No Live Stream Active';
            streamStatus.textContent = 'Broadcaster disconnected';
            liveStreams.innerHTML = '';
            if (peerConnection) peerConnection.close();
        }
    });

    socket.on('update-users', (totalUsers, activeStreams) => {
        userCount.textContent = totalUsers;
        streamCount.textContent = activeStreams;
    });

    socket.on('force-stop', () => {
        if (isBroadcaster) stopBroadcasting();
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
