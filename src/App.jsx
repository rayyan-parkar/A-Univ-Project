import React, { useEffect, useRef } from 'react';
import VibrationSensor from './VibrationSensor';
import SphericalGraph from './SphericalGraph';
import CommunicationData from './CommunicationData'
import logo from '/logo.png';
import rightLogo from '/right-logo.jpg';
import videoUnavailable from '/video-unavailable.jpg';
import './App.css';

import { useExperimentSession } from './hooks/useExperimentSession';
import { useWebRTC } from './hooks/useWebRTC';
import { useDataBroadcaster } from './hooks/useDataBroadcaster';
import SetupScreen from './components/SetupScreen';

function App() {
  const session = useExperimentSession();
  const {
    socketRef,
    socketEpoch,
    connectionStatus,
    sessionState,
    role,
    generatedPassword,
    authError,
    configureSession,
    claimHost,
    authenticate,
    updateGraphData,
    syncDelayMs,
    setSyncDelayMs,
    graphData,
    liveIngestStatus
  } = session;

  const webrtc = useWebRTC(socketRef, role, socketEpoch);
  const broadcaster = useDataBroadcaster(socketRef, updateGraphData, socketEpoch, sessionState === 'ACTIVE' && role === 'host', liveIngestStatus);

  const videoRef = useRef(null);

  const hasActiveStream = (role === 'host' && Boolean(webrtc.localStream)) || (role === 'viewer' && Boolean(webrtc.remoteStream && webrtc.isHostStreaming));

  useEffect(() => {
    if (videoRef.current) {
      if (role === 'host' && webrtc.localStream) {
        videoRef.current.srcObject = webrtc.localStream;
        videoRef.current.play().catch(() => { });
      } else if (role === 'viewer' && webrtc.remoteStream && webrtc.isHostStreaming) {
        videoRef.current.srcObject = webrtc.remoteStream;
        videoRef.current.play().catch(() => { });
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [webrtc.localStream, webrtc.remoteStream, webrtc.isHostStreaming, role]);

  const getStatusClass = () => {
    const status = connectionStatus.toLowerCase();
    if (status.includes('connected')) return 'status-connected';
    if (status.includes('error')) return 'status-error';
    return 'status-disconnected';
  };

  // If not ACTIVE, or Viewer hasn't authenticated yet, show Setup Screen
  if (sessionState !== 'ACTIVE' || role === 'waiting' || role === 'viewer-auth-required' || (role === 'viewer' && sessionState === 'AUTH_REQUIRED')) {
    return (
      <SetupScreen
        sessionState={sessionState}
        role={role}
        authError={authError}
        configureSession={configureSession}
        authenticate={authenticate}
        claimHost={claimHost}
        streamError={webrtc.streamError}
      />
    );
  }

  // Active Session (Host or authenticated Viewer)
  return (
    <div className="app-container">
      <div className="top-container">
        <div className="logo">
          <img src={logo} alt="UNAVAILABLE" />
        </div>

        <h1>Fixed Precision Impact on State-of-Polarization Sensing using Coherent Transceivers</h1>

        <div className="logo">
          <img src={rightLogo} alt="UNAVAILABLE" />
        </div>
      </div>

      <div className="body-container">
        <h2>
          Aston Institute of Photonics Technologies Aston University,
          Birmingham, UK Geraldo Gomes, Rafael Vieira, Pedro Freire,
          Yaroslav Prylepskiy, Sergei Turitsyn
        </h2>

        <div className={`connection-status ${getStatusClass()}`}>
          Connection Status: {connectionStatus} | Role: {role.toUpperCase()}
          {role === 'host' && generatedPassword && (
            <span style={{ marginLeft: '20px', color: '#ffea00' }}>
              Session Password: {generatedPassword}
            </span>
          )}
          {role === 'host' && (
              <span style={{ marginLeft: '20px', color: broadcaster.isBroadcasting ? '#00ff00' : '#888888' }}>
              Data Engine: {broadcaster.statusMessage}
            </span>
          )}
        </div>

        <div className="grid-container">
          {/* --- Left Column --- */}
          <div className="left-column">

            {role === 'host' && (
              <div className="host-controls-panel">
                <div className="host-controls-row">
                  {!webrtc.localStream ? (
                    <button className="host-btn camera-btn" onClick={webrtc.startHostStream}>
                      Start Camera Broadcast
                    </button>
                  ) : (
                    <>
                      <span className="host-badge camera-active">📹 Camera Active</span>
                      <button className="host-btn camera-stop-btn" onClick={webrtc.stopHostStream}>Stop Camera</button>
                    </>
                  )}

                  {!broadcaster.isBroadcasting && !broadcaster.isStarting ? (
                    <button className="host-btn data-start-btn" onClick={broadcaster.startBroadcasting}>
                      Start Data Broadcast
                    </button>
                  ) : (
                    <button className="host-btn data-stop-btn" onClick={broadcaster.stopBroadcasting}>
                      ⏹ Stop Data Broadcast
                    </button>
                  )}
                </div>

                <div className="host-mode-row">
                  <span className="mode-label">Mode:</span>
                  <label className="mode-option">
                    <input
                      type="radio"
                      name="broadcastMode"
                      value="debug"
                      checked={broadcaster.broadcastMode === 'debug'}
                      onChange={() => broadcaster.setBroadcastMode('debug')}
                      disabled={broadcaster.isBroadcasting || broadcaster.isStarting}
                    />
                    Debug / Simulation (In-Memory)
                  </label>
                  <label className="mode-option">
                    <input
                      type="radio"
                      name="broadcastMode"
                      value="live"
                      checked={broadcaster.broadcastMode === 'live'}
                      onChange={() => broadcaster.setBroadcastMode('live')}
                      disabled={broadcaster.isBroadcasting || broadcaster.isStarting}
                    />
                    📂 Live Experiment Files
                  </label>
                </div>

                {broadcaster.broadcastMode === 'live' && (
                  <div className="file-selection-area">
                    <span className="dir-label">Folder:</span>
                    <input
                      type="text"
                      className="host-dir-input"
                      value={broadcaster.liveDir}
                      onChange={(e) => broadcaster.setLiveDir(e.target.value)}
                      disabled={broadcaster.isBroadcasting || broadcaster.isStarting}
                      placeholder="Absolute path printed by mock_experiment_writer"
                    />
                    <button
                      type="button"
                      className={`host-preset-btn ${broadcaster.liveDir === './src/data' ? 'active' : ''}`}
                      onClick={() => broadcaster.setLiveDir('./src/data')}
                      disabled={broadcaster.isBroadcasting || broadcaster.isStarting}
                    >
                      📦 src/data
                    </button>
                  </div>
                )}

                <div className="host-sync-row">
                  <span className="mode-label">A/V Sync Delay:</span>
                  <input
                    type="range"
                    min="0"
                    max="400"
                    step="10"
                    value={syncDelayMs}
                    onChange={(e) => setSyncDelayMs(parseInt(e.target.value) || 0)}
                    className="sync-slider"
                  />
                  <span className="sync-value-pill">{syncDelayMs} ms</span>
                  <span className="sync-hint">(Syncs graphs with camera feed latency)</span>
                </div>
              </div>
            )}

            <div className="video-container">
              {hasActiveStream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <img src={videoUnavailable} alt="Video Unavailable" />
              )}
              {role === 'viewer' && !webrtc.isHostStreaming && (
                <button className="host-btn camera-btn" onClick={webrtc.restartViewerStream}>Restart Camera Stream</button>
              )}
              {webrtc.streamError && <p className="error-text">{webrtc.streamError}</p>}
            </div>

            <div className="vibration-container">
              <VibrationSensor latestData={graphData.vibrationValue} title='Vibration Sensor' />
              <VibrationSensor latestData={graphData.vibrationFPGA} title='FPGA Sensing' />
            </div>
          </div>

          {/* --- Right Column --- */}
          <div className="right-column">
            <div style={{ position: 'relative' }}>
              <div className="sop-text">SOP</div>
              <div className="spherical-container">
                <SphericalGraph vectorData={graphData.vectorData1} title="Low Precision" />
                <SphericalGraph vectorData={graphData.vectorData2} title="Medium Precision" />
                <SphericalGraph vectorData={graphData.vectorData3} title="High Precision" />
              </div>
            </div>
            <div className="comms-section">
              <h2>Communication Data</h2>
              <div className="comms-container">
                <CommunicationData latestData={graphData.communicationData?.[0]} />
                <CommunicationData latestData={graphData.communicationData?.[1]} />
                <CommunicationData latestData={graphData.communicationData?.[2]} />
              </div>
            </div>
          </div>
        </div>

        <footer>
          <p>By Rayyan Parkar</p>
        </footer>

      </div>
    </div>
  )
}

export default App;
