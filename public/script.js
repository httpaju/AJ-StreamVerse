const socket = io();
const isBroadcastPage = window.location.pathname.includes('broadcast.html');
const isViewerPage = window.location.pathname.includes('viewer.html');
const isAdminPage = window.location.pathname.includes('admin.html');
let localStream;
let peerConnections = {}; // For broadcaster to manage multiple viewers
let peerConnection; // For viewer

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

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
            console.log('Broadcaster started');
        } catch (err) {
            console.error('Error starting broadcast:', err);
        }
    };

    stopButton.onclick = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
            Object.values(peerConnections).forEach(pc => pc.close());
            peerConnections = {};
            startButton.disabled = false;
            stopButton.disabled = true;
            streamStatus.textContent = 'Not Live';
            socket.emit('broadcaster-stopped'); // Notify viewers explicitly
            console.log('Broadcast stopped');
        }
    };

    socket.on('watcher', (viewerId) => {
        if (!localStream) return; // Ignore if not broadcasting yet
        console.log('New watcher:', viewerId);
        const peerConnection = new RTCPeerConnection(config);
        peerConnections[viewerId] = peerConnection;

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: viewerId, candidate: event.candidate });
                console.log('Sent ICE candidate to', viewerId);
            }
        };
        peerConnection.onconnectionstatechange = () => {
            console.log('Broadcaster connection state for', viewerId, ':', peerConnection.connectionState);
            if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
                delete peerConnections[viewerId];
                peerConnection.close();
            }
        };

        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                socket.emit('offer', { offer: peerConnection.localDescription, target: viewerId });
                console.log('Offer sent to', viewerId);
            })
            .catch(err => console.error('Error creating offer:', err));
    });

    socket.on('answer', (data) => {
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
                .then(() => console.log('Answer received from', data.sender))
                .catch(err => console.error('Error setting answer:', err));
        } else {
            console.warn('No peer connection for sender:', data.sender);
        }
    });

    socket.on('ice-candidate', (data) => {
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                .then(() => console.log('ICE candidate added from', data.sender))
                .catch(err => console.error('Error adding ICE candidate:', err));
        }
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

    function setupViewer() {
        if (peerConnection) peerConnection.close();
        peerConnection = new RTCPeerConnection(config);
        peerConnection.ontrack = (event) => {
            remoteVideo.srcObject = event.streams[0];
            streamTitle.textContent = 'Live Stream';
            streamStatus.textContent = 'Watching Live';
            console.log('Stream received');
        };
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate });
                console.log('Sent ICE candidate to broadcaster');
            }
        };
        peerConnection.onconnectionstatechange = () => {
            console.log('Viewer connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
                remoteVideo.srcObject = null;
                streamTitle.textContent = 'No Live Stream';
                streamStatus.textContent = 'Broadcaster disconnected';
                retryConnection();
            }
        };
        socket.emit('watcher');
        console.log('Watcher emitted');
    }

    function retryConnection() {
        setTimeout(setupViewer, 2000); // Retry every 2 seconds if disconnected
    }

    socket.on('connect', () => {
        setupViewer();
    });

    socket.on('broadcaster-available', () => {
        if (!remoteVideo.srcObject) {
            setupViewer();
        }
    });

    socket.on('offer', async (data) => {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', { answer, target: data.sender });
            console.log('Answer sent to broadcaster');
        } catch (err) {
            console.error('Error handling offer:', err);
            retryConnection();
        }
    });

    socket.on('ice-candidate', (candidate) => {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .then(() => console.log('ICE candidate added from broadcaster'))
            .catch(err => console.error('Error adding ICE candidate:', err));
    });

    socket.on('broadcaster-disconnected', () => {
        remoteVideo.srcObject = null;
        streamTitle.textContent = 'No Live Stream';
        streamStatus.textContent = 'Broadcaster disconnected';
        if (peerConnection) peerConnection.close();
        retryConnection();
    });

    socket.on('broadcaster-stopped', () => {
        remoteVideo.srcObject = null;
        streamTitle.textContent = 'No Live Stream';
        streamStatus.textContent = 'Broadcaster stopped';
        if (peerConnection) peerConnection.close();
        retryConnection();
    });

    socket.on('update-users', (totalUsers, activeStreams) => {
        userCount.textContent = totalUsers;
        streamCount.textContent = activeStreams;
    });

    // Initial setup
    setupViewer();
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
