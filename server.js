const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 80;

// Create a persistent user data directory for browser data
const USER_DATA_DIR = path.join(__dirname, 'browser-data');

// Ensure browser data directory exists
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

// Global browser instance to maintain session
let globalBrowser = null;
let globalPage = null;
const consoleMessages = [];

// Puppeteer configuration for persistent, non-headless browser
const getPuppeteerConfig = () => ({
  headless: true, // Show the browser window
  userDataDir: USER_DATA_DIR, // Persistent directory for cookies, passwords, etc.
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security', // Allow cross-origin requests
    '--disable-features=VizDisplayCompositor', // Improve compatibility
    '--start-maximized', // Start with maximized window
    '--no-first-run', // Skip first run setup
    '--no-default-browser-check', // Skip default browser check
    '--disable-blink-features=AutomationControlled', // Hide automation
    '--disable-extensions-except', // Allow certain extensions
    '--always-on-top', // Keep browser window on top
    '--kiosk-printing', // Prevent browser from losing focus
    '--disable-background-timer-throttling', // Prevent background throttling
    '--disable-backgrounding-occluded-windows', // Prevent backgrounding
    '--disable-renderer-backgrounding', // Keep renderer active
    '--auto-open-devtools-for-tabs=false', // Don't auto-open devtools
  ],
  defaultViewport: null, // Use full browser window size
  devtools: false, // Set to true if you want devtools open by default
});

// Initialize browser automatically
async function initializeBrowser() {
  try {
    console.log('🚀 Starting browser session...');
    globalBrowser = await puppeteer.launch(getPuppeteerConfig());
    
    // Handle browser disconnect
    globalBrowser.on('disconnected', () => {
      console.log('🔌 Browser disconnected');
      globalBrowser = null;
      globalPage = null;
    });
    
    // Create initial page
    globalPage = await globalBrowser.newPage();
    
    // Bring browser window to front and focus it
    await globalPage.bringToFront();
    
    // Click somewhere on the page to activate it
    await globalPage.evaluate(() => {
      document.body.click();
    });
    
    // Set up periodic focus to keep window active (every 30 seconds)
    setInterval(async () => {
      if (globalPage && !globalPage.isClosed()) {
        try {
          await globalPage.bringToFront();
          // Click to keep page active
          await globalPage.evaluate(() => {
            if (document.body) {
              document.body.click();
            }
          });
        } catch (error) {
          // Ignore errors if page is closed or browser is disconnected
        }
      }
    }, 30000);
    
    // Set up console message listener
    globalPage.on('console', msg => {
      const timestamp = new Date().toLocaleTimeString();
      const consoleMessage = {
        timestamp,
        type: msg.type(),
        text: msg.text(),
        location: msg.location() ? `${msg.location().url}:${msg.location().lineNumber}` : 'unknown'
      };
      
      // Add to messages array (keep last 100 messages)
      consoleMessages.push(consoleMessage);
      if (consoleMessages.length > 100) {
        consoleMessages.shift();
      }
      
      // Emit to all connected clients
      io.emit('console-message', consoleMessage);
      
      console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // Set up page error listener
    globalPage.on('pageerror', error => {
      const timestamp = new Date().toLocaleTimeString();
      const errorMessage = {
        timestamp,
        type: 'pageerror',
        text: error.message,
        location: 'page error'
      };
      
      consoleMessages.push(errorMessage);
      if (consoleMessages.length > 100) {
        consoleMessages.shift();
      }
      
      io.emit('console-message', errorMessage);
      console.log(`[BROWSER ERROR] ${error.message}`);
    });

    // Set up request failed listener
    globalPage.on('requestfailed', request => {
      const timestamp = new Date().toLocaleTimeString();
      const failMessage = {
        timestamp,
        type: 'requestfailed',
        text: `Failed to load: ${request.url()} - ${request.failure().errorText}`,
        location: request.url()
      };
      
      consoleMessages.push(failMessage);
      if (consoleMessages.length > 100) {
        consoleMessages.shift();
      }
      
      io.emit('console-message', failMessage);
    });
    
    // Set a reasonable user agent
    await globalPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    
    // Navigate to the game URL initially
    await globalPage.goto('https://lom.joynetgame.com/', { waitUntil: 'networkidle2' });
    
    console.log('✅ Browser session started and ready for credentials setup');
    return true;
  } catch (error) {
    console.error('❌ Failed to start browser:', error);
    return false;
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('📱 Client connected to console stream');
  
  // Send existing console messages to new client
  socket.emit('console-history', consoleMessages);
  
  socket.on('disconnect', () => {
    console.log('📱 Client disconnected from console stream');
  });

  // Handle clear console request
  socket.on('clear-console', () => {
    consoleMessages.length = 0;
    io.emit('console-cleared');
  });
});

// Middleware - removed helmet for simplicity
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  const browserStatus = globalBrowser && globalBrowser.isConnected() ? 'connected' : 'disconnected';
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    browserStatus,
    userDataDir: USER_DATA_DIR,
    consoleMessages: consoleMessages.length
  });
});

// Navigate to URL endpoint
app.post('/navigate', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    if (!globalPage) {
      return res.status(500).json({ error: 'Browser not available' });
    }

    await globalPage.goto(url, { waitUntil: 'networkidle2' });
    
    // Bring browser to front after navigation
    await globalPage.bringToFront();
    
    // Click to activate the page
    await globalPage.evaluate(() => {
      if (document.body) {
        document.body.click();
      }
    });
    
    const currentUrl = globalPage.url();
    const title = await globalPage.title();
    
    // Emit navigation event
    io.emit('navigation', { currentUrl, title, timestamp: new Date().toLocaleTimeString() });
    
    res.json({ 
      success: true, 
      message: 'Navigation successful',
      currentUrl,
      title
    });
  } catch (error) {
    console.error('Navigation error:', error);
    res.status(500).json({ error: 'Failed to navigate', message: error.message });
  }
});

// Screenshot endpoint
app.get('/screenshot', async (req, res) => {
  try {
    if (!globalPage) {
      return res.status(500).json({ error: 'Browser not available' });
    }

    const screenshot = await globalPage.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false
    });
    
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(screenshot);
  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({ error: 'Failed to take screenshot', message: error.message });
  }
});

// Refresh page endpoint
app.post('/refresh', async (req, res) => {
  try {
    if (!globalPage) {
      return res.status(500).json({ error: 'Browser not available' });
    }

    // Get current URL before refresh
    const currentUrl = globalPage.url();
    
    // Do a hard refresh by navigating to the same URL again
    // This bypasses cache and does a full reload
    await globalPage.goto(currentUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Bring browser to front after refresh
    await globalPage.bringToFront();
    
    // Click to activate the page and ensure user interaction
    await globalPage.evaluate(() => {
      if (document.body) {
        document.body.click();
        // Also try to focus the document
        document.body.focus();
        // Trigger a user interaction to enable audio context
        const event = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        document.body.dispatchEvent(event);
      }
    });
    
    const title = await globalPage.title();
    
    // Emit refresh event
    io.emit('navigation', { currentUrl, title, timestamp: new Date().toLocaleTimeString(), action: 'hard_refresh' });
    
    res.json({ 
      success: true, 
      message: 'Page hard refreshed successfully',
      currentUrl,
      title
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh page', message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n📝 Saving browser data and shutting down...');
  if (globalBrowser && globalBrowser.isConnected()) {
    await globalBrowser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n📝 Saving browser data and shutting down...');
  if (globalBrowser && globalBrowser.isConnected()) {
    await globalBrowser.close();
  }
  process.exit(0);
});

server.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:80`);
  console.log(`📁 Browser data will be saved in: ${USER_DATA_DIR}`);
  console.log(`💡 Starting browser automatically...`);
  
  // Auto-start browser
  const browserStarted = await initializeBrowser();
  if (browserStarted) {
    console.log(`🎯 Browser is ready! You can now set up your credentials.`);
    console.log(`🌐 Visit http://localhost:80 for the web interface`);
    console.log(`🖥️  Live console streaming is active!`);
  } else {
    console.log(`⚠️  Browser failed to start, but server is running`);
  }
}); 