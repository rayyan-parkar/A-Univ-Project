# Fixed Precision Impact on State-of-Polarization Sensing

A real-time visualization application developed for the **Aston Institute of Photonics Technologies** at Aston University, presented at the **OFC (Optical Fiber Communication) Conference**. 

## Overview

This custom software application was created to demonstrate and visualize the impact of fixed precision on State-of-Polarization (SOP) sensing using coherent transceivers. The application provides real-time data visualization of photonics research, including vibration sensing, SOP vector representations, and communication metrics.

This software was developed specifically for the Photonics Department at Aston University to demonstrate research findings at the OFC Conference. The application visualizes the effects of numerical precision on State-of-Polarization measurements in coherent optical transceivers.

## Research Team

**Aston Institute of Photonics Technologies, Aston University, Birmingham, UK**
- Geraldo Gomes
- Rafael Vieira
- Pedro Freire
- Yaroslav Prylepskiy
- Sergei Turitsyn

## Features

### Real-Time Data Visualization
- **Vibration Sensing**:  Displays live vibration sensor data and FPGA sensing measurements
- **State-of-Polarization Visualization**: Interactive 3D spherical graphs showing SOP vectors at three precision levels: 
  - Low Precision
  - Medium Precision
  - High Precision
- **Communication Data Monitoring**: Real-time communication metrics and performance data
- **Video Feed Support**: Infrastructure for live video streaming (configurable)

### Connection Management
- WebSocket-based real-time data streaming
- Automatic reconnection with visual countdown (up to 3 attempts)
- Connection status indicators with color-coded feedback: 
  - 🟢 Connected
  - 🟡 Error/Warning
  - 🔴 Disconnected
- Server capacity management

## Technology Stack

### Frontend
- **React** 19.1.1 - UI framework
- **Vite** 7.1.2 - Build tool and dev server
- **Three.js** 0.180.0 - 3D graphics rendering
- **@react-three/fiber** & **@react-three/drei** - React renderer for Three.js
- **Chart.js** & **react-chartjs-2** - Data visualization charts

### Backend/Communication
- **WebSocket (ws)** - Real-time bidirectional communication
- **Node Media Server** - Media streaming capabilities
- **dotenv** - Environment configuration

### Development Tools
- **ESLint** - Code linting and quality
- **Vite** - Hot module replacement and optimized builds

## Prerequisites

- Node.js (v16 or higher recommended)
- npm or yarn package manager
- WebSocket server endpoint (for data streaming)

## Installation

1. Clone the repository: 
```bash
git clone https://github.com/rayyan-parkar/A-Univ-Project.git
cd A-Univ-Project/my-app
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root with required environment variables:
```env
VITE_RECEIVER_KEY=your_receiver_key_here
```

## Usage

### Development Mode
Start the development server with hot reload:
```bash
npm run dev
```

The application will be available at `http://localhost:5173` (or another port specified by Vite).

### Production Build
Build the application for production:
```bash
npm run build
```

Preview the production build: 
```bash
npm run preview
```

## Project Structure

```
my-app/
├── src/
│   ├── App.jsx                  # Main application component
│   ├── VibrationSensor.jsx      # Vibration data visualization
│   ├── SphericalGraph.jsx       # 3D SOP vector visualization
│   ├── CommunicationData.jsx    # Communication metrics display
│   ├── API.js                   # API utilities
│   ├── sender.js                # WebSocket sender logic
│   ├── server.js                # Server configuration
│   ├── webrtc. js                # WebRTC utilities
│   ├── data/                    # Data files
│   ├── App.css                  # Application styles
│   ├── index.css                # Global styles
│   └── main.jsx                 # Application entry point
├── public/
│   ├── logo.png                 # Institution logo
│   ├── right-logo.jpg           # Secondary logo
│   └── video-unavailable.jpg    # Video placeholder
├── index.html
├── vite.config.js
├── package.json
└── eslint.config.js
```

## WebSocket Protocol

The application connects to a WebSocket server expecting messages in the following formats:

### Waveform Data
```json
{
  "type": "waveform",
  "data": [vibrationValue, fpgaValue]
}
```

### Vector Data (SOP)
```json
{
  "type": "vector",
  "data": [
    [x1, y1, z1], [x2, y2, z2], [x3, y3, z3],  // Low precision
    [x4, y4, z4], [x5, y5, z5], [x6, y6, z6],  // Medium precision
    [x7, y7, z7], [x8, y8, z8], [x9, y9, z9]   // High precision
  ]
}
```

### Communication Data
```json
{
  "type": "communication",
  "data": {... }
}
```

## UI Components

- **Header**:  Displays project title and institutional logos
- **Status Bar**: Real-time connection status with reconnection countdown
- **Left Column**:
  - Video feed display (configurable)
  - Dual vibration sensor readings
- **Right Column**:
  - Three 3D spherical SOP graphs (Low/Medium/High precision)
  - Communication data metrics panels

## Configuration

### WebSocket Connection
The WebSocket endpoint can be configured in `App.jsx`:
```javascript
// Local development
const socket = new WebSocket(`ws://localhost:8080?role=receiver&token=${key}`);

// Production (uncomment and configure)
// const socket = new WebSocket(`wss://ws.YOUR_DOMAIN.com? role=receiver&token=${key}`);
```

### Environment Variables
- `VITE_RECEIVER_KEY`: Authentication token for WebSocket connection

## License

This project was developed as custom research software for Aston University.  Please contact the research team or institution for licensing information.

## Contact

For questions about this software or the research project: 

**Aston Institute of Photonics Technologies**  
Aston University  
Birmingham, United Kingdom

---

**To be Presented at the OFC Conference**
