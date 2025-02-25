const socket = io();
const isBroadcastPage = window.location.pathname.includes('broadcast.html');
const isViewerPage = window.location.pathname.includes('viewer.html');
const isAdminPage = window.location.pathname.includes('admin.html');
let localStream;
let peerConnections = {};
let peerConnection;
let retryInterval;

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// Google Sign-In callback
function handleCredentialResponse(response) {
    const idToken = response.credential;
    const profile = decodeJwt(idToken); // Simple JWT decode (below)
    console.log('Google Sign-In successful:', profile.email);

    if (isBroadcastPage) {
        const signinForm = document.getElementById('signin-form');
        const broadcastControls = document.getElementById('broadcast-controls');
        const signinStatus = document.getElementById('signinStatus');

        signinForm.style.display = 'none';
        broadcastControls.style.display = 'block';
        signinStatus.textContent = `Signed in as ${profile.email}`;
        signinStatus.style.color = 'green';

        // Notify server of authenticated broadcaster
        socket.emit('broadcaster-login', { email: profile.email });
    }
}

// Simple JWT decoder (for demo purposes; use a library like jwt-decode in production)
function decodeJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// Broadcaster page logic
if (isBroadcastPage) {
    const localVideo = document.getElementById('localVideo');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const streamTitle = document.getElementById('streamTitle');
    const streamStatus = document.getElementById('streamStatus');
    const userCount = document.getElementById('userCount');
    const streamCount = document.getElementById('streamCount');
    const broadcastControls = document.getElementById('broadcast-controls');

    socket.on('broadcaster-auth-required', () => {
        broadcastControls.style.display = 'none';
        document.getElementById('signin-form').style.display = 'block';
        document.getElementById('signinStatus').textContent = 'Authentication required';
        document.getElementById('signinStatus').style.color = 'red';
    });

    startButton.onclick = async () => {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            socket.emit('broadcaster');
            startButton.disabled = true;
            stopButton.disabled = false;
            streamStatus.textContent = 'Live Now';
            console.log('Broadcaster started with tracks:', localStream.getTracks());
        } catch (err) {
            console.error('Error starting broadcast:', err);
            streamStatus.textContent = 'Failed to start (check permissions)';
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
            socket.emit('broadcaster-stopped');
            console.log('Broadcast stopped');
        }
    };

    socket.on('watcher', async (viewerId) => {
        if (!localStream) {
            console.warn('No stream available for watcher:', viewerId);
            return;
        }
        console.log('New watcher:', viewerId);
        const peerConnection = new RTCPeerConnection(config);
        peerConnections[viewerId] = peerConnection;

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log('Added track to', viewerId, ':', track.kind);
        });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: viewerId, candidate: event.candidate });
                console.log('Sent ICE candidate to', viewerId);
            }
        };
        peerConnection.onconnectionstatechange = () => {
            console.log('Broadcaster state for', viewerId, ':', peerConnection.connectionState);
            if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
                delete peerConnections[viewerId];
                peerConnection.close();
            }
        };

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', { offer: peerConnection.localDescription, target: viewerId });
            console.log('Offer sent to', viewerId);
        } catch (err) {
            console.error('Error creating offer for', viewerId, ':', err);
        }
    });

    socket.on('answer', (data) => {
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
                .then(() => console.log('Answer received from', data.sender))
                .catch(err => console.error('Error setting answer from', data.sender, ':', err));
        }
    });

    socket.on('ice-candidate', (data) => {
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                .then(() => console.log('ICE candidate added from', data.sender))
                .catch(err => console.error('Error adding ICE candidate from', data.sender, ':', err));
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

// Viewer page logic (unchanged)
if (isViewerPage) {
    const remoteVideo = document.getElementById('remoteVideo');
    const streamTitle = document.getElementById('streamTitle');
    const streamStatus = document.getElementById('streamStatus');
    const userCount = document.getElementById('userCount');
    const streamCount = document.getElementById('streamCount');

    function setupViewer() {
        if (peerConnection) peerConnection.close();
        peerConnection = new RTCPeerConnection(config);
        let trackReceived = false;

        peerConnection.ontrack = (event) => {
            remoteVideo.srcObject = event.streams[0];
            streamTitle.textContent = 'Live Stream';
            streamStatus.textContent = 'Watching Live';
            trackReceived = true;
            console.log('Track received:', event.track.kind);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: 'broadcaster', candidate: event.candidate });
                console.log('Sent ICE candidate to broadcaster');
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log('Viewer state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected' && !trackReceived) {
                console.warn('Connected but no tracks; retrying...');
                retryConnection();
            } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
                resetViewer();
                retryConnection();
            }
        };

        socket.emit('watcher');
        console.log('Watcher emitted');

        setTimeout(() => {
            if (!trackReceived && peerConnection.connectionState !== 'connected') {
                console.warn('No tracks received; retrying...');
                retryConnection();
            }
        }, 5000);
    }

    function resetViewer() {
        remoteVideo.srcObject = null;
        streamTitle.textContent = 'No Live Stream';
        streamStatus.textContent = 'Waiting for a broadcast...';
        if (peerConnection) peerConnection.close();
        clearInterval(retryInterval);
    }

    function retryConnection() {
        resetViewer();
        retryInterval = setInterval(() => {
            if (!remoteVideo.srcObject) {
                setupViewer();
            } else {
                clearInterval(retryInterval);
            }
        }, 2000);
    }

    socket.on('connect', () => {
        setTimeout(setupViewer, 1000);
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
        resetViewer();
        retryConnection();
    });

    socket.on('broadcaster-stopped', () => {
        resetViewer();
        retryConnection();
    });

    socket.on('update-users', (totalUsers, activeStreams) => {
        userCount.textContent = totalUsers;
        streamCount.textContent = activeStreams;
    });

    setTimeout(setupViewer, 1000);
}

// Admin page logic (unchanged)
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
