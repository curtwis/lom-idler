const socket = io();
const urlInput = document.getElementById('urlInput');
const browserScreenshot = document.getElementById('browserScreenshot');
const screenshotStatus = document.getElementById('screenshotStatus');
const currentStatus = document.getElementById('currentStatus');
const disconnectedOverlay = document.getElementById('disconnectedOverlay');
const reconnectBtn = document.querySelector('.reconnect-btn');

// Screenshot update functionality
let screenshotInterval;

function updateScreenshot() {
    const timestamp = new Date().getTime();
    browserScreenshot.src = `/screenshot?t=${timestamp}`;
    screenshotStatus.textContent = new Date().toLocaleTimeString();
}

function startScreenshotUpdates() {
    // Update immediately
    updateScreenshot();
    
    // Then update every 1 second
    screenshotInterval = setInterval(updateScreenshot, 1000);
}

function stopScreenshotUpdates() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }
}

function showDisconnectedOverlay() {
    disconnectedOverlay.style.display = 'flex';
    reconnectBtn.style.display = 'inline-block'; // Force show
    reconnectBtn.classList.add('visible');
    stopScreenshotUpdates();
}

function hideDisconnectedOverlay() {
    disconnectedOverlay.style.display = 'none';
    reconnectBtn.classList.remove('visible');
    reconnectBtn.style.display = 'none'; // Force hide
    startScreenshotUpdates();
}

// Handle screenshot loading errors
browserScreenshot.onerror = function() {
    screenshotStatus.textContent = 'Error loading screenshot';
};

browserScreenshot.onload = function() {
    screenshotStatus.textContent = new Date().toLocaleTimeString();
};

// Start screenshot updates when page loads
document.addEventListener('DOMContentLoaded', startScreenshotUpdates);

// Socket connection events
socket.on('connect', () => {
    currentStatus.textContent = 'Connected';
    currentStatus.classList.remove('disconnected');
    hideDisconnectedOverlay();
});

socket.on('disconnect', () => {
    currentStatus.textContent = 'Disconnected';
    currentStatus.classList.add('disconnected');
    showDisconnectedOverlay();
});

// Keep console listeners for background processing (not displayed)
socket.on('console-history', (messages) => {
    // Console messages received but not displayed
    messages.forEach(message => {
        checkForDisconnection(message);
    });
});

socket.on('console-message', (message) => {
    // Console message received but not displayed
    checkForDisconnection(message);
});

socket.on('console-cleared', () => {
    // Console cleared but not displayed
});

socket.on('navigation', (navData) => {
    // Navigation event received but not displayed
});

function navigate() {
    const url = urlInput.value.trim();
    if (!url) {
        alert('Please enter a URL');
        return;
    }

    fetch('/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            urlInput.value = '';
        } else {
            alert('Navigation failed: ' + data.error);
        }
    })
    .catch(error => {
        alert('Navigation error: ' + error.message);
    });
}

function clearConsole() {
    socket.emit('clear-console');
}

function reconnect() {
    // Immediately clear all disconnected states using our existing function
    hideDisconnectedOverlay();
    
    // Ensure status is set to Connected and remove any disconnected styling
    currentStatus.textContent = 'Connected';
    currentStatus.classList.remove('disconnected');
    
    // Force hide the reconnect button
    reconnectBtn.style.display = 'none';
    reconnectBtn.classList.remove('visible');
    
    // Disconnect and reconnect socket
    socket.disconnect();
    socket.connect();
    
    // Refresh the browser page
    fetch('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Browser page refreshed successfully');
        } else {
            console.error('Failed to refresh browser page:', data.error);
        }
    })
    .catch(error => {
        console.error('Refresh error:', error.message);
    });
}

// Allow Enter key to navigate
urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        navigate();
    }
});

// Function to check if console message indicates disconnection
function checkForDisconnection(message) {
    if (message.text && message.text.includes('onclose: wasClean = false, code=1006')) {
        currentStatus.textContent = 'Disconnected';
        currentStatus.classList.add('disconnected');
        showDisconnectedOverlay();
    }
} 