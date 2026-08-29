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
import SetupScreen from './components/SetupScreen';

function App() {
  const session = useExperimentSession();
  const { socketRef, connectionStatus, sessionState, role, generatedPassword, authError, configureSession, authenticate, senderConnected, graphData } = session;

  const webrtc = useWebRTC(socketRef, role);

  const videoRef = useRef(null);

  const hasActiveStream = (role === 'host' && Boolean(webrtc.localStream)) || (role === 'viewer' && Boolean(webrtc.remoteStream && webrtc.isHostStreaming));

  useEffect(() => {
    if (videoRef.current) {
      if (role === 'host' && webrtc.localStream) {
        videoRef.current.srcObject = webrtc.localStream;
        videoRef.current.play().catch(() => {});
      } else if (role === 'viewer' && webrtc.remoteStream && webrtc.isHostStreaming) {
        videoRef.current.srcObject = webrtc.remoteStream;
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [webrtc.localStream, webrtc.remoteStream, webrtc.isHostStreaming, role]);

  const getStatusClass = () => {
    if (connectionStatus.includes('Connected')) return 'status-connected';
    if (connectionStatus.includes('Error')) return 'status-error';
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
            <span style={{ marginLeft: '20px', color: senderConnected ? '#00ff00' : '#ff0000' }}>
              Data Source Connected: {senderConnected ? 'YES' : 'NO'}
            </span>
          )}
        </div>

        <div className="grid-container">
          {/* --- Left Column --- */}
          <div className="left-column">

            {role === 'host' && !webrtc.localStream && (
              <div style={{ marginBottom: '10px' }}>
                <button onClick={webrtc.startHostStream} style={{ padding: '10px', width: '100%', cursor: 'pointer' }}>
                  Start Camera Broadcast
                </button>
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
            <div>
              <h2>Communication Data</h2>
              <div className="comms-container">
                <CommunicationData latestData={graphData.communicationData} />
                <CommunicationData latestData={graphData.communicationData} />
                <CommunicationData latestData={graphData.communicationData} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default App;
