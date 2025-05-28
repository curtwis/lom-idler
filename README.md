# LOM Idler


## Prerequisites

- Node.js (v14 or higher)
- npm

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/curtwis/lom-idler
   cd lom-idler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

## Initial Setup

**For first-time login:**
1. Change line 35 in `server.js` from `headless: true` to `headless: false`
   This will allow you to interact with the browser window and login for the first time

2. After the initial login, change headless back to `false` for background operation

## Usage

1. **Start the server**
   ```bash
   node server.js
   ```

2. **Access the web interface**
   - Open your browser and go to: `http://localhost`
   - Port forward the port that the server is running on to be able to access the web interface anywhere

## Configuration

- **Screenshot update rate** - Modify the interval in `public/console.js` (currently 1 second)
- **Port** - Server runs on port 80 by default

## Notes

- The browser will maintain your login session between restarts
- Use headless mode for production/background operation
- Use non-headless mode for initial setup and troubleshooting