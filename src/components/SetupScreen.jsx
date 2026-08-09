import React, { useState } from 'react';

export default function SetupScreen({ sessionState, role, authError, configureSession, authenticate }) {
    const [maxClients, setMaxClients] = useState(3);
    const [password, setPassword] = useState('');
    const [whitelist, setWhitelist] = useState('');

    const handleConfigure = (e) => {
        e.preventDefault();
        const ipArray = whitelist.split(',').map(ip => ip.trim()).filter(ip => ip);
        configureSession(maxClients, password, ipArray);
    };

    const handleAuth = (e) => {
        e.preventDefault();
        authenticate(password);
    };

    if (sessionState === 'CONNECTING') {
        return (
            <div className="setup-container">
                <h2>Connecting to global SFU server...</h2>
            </div>
        );
    }

    if (sessionState === 'DISCONNECTED') {
        return (
            <div className="setup-container">
                <h2>Disconnected from server.</h2>
                <button onClick={() => window.location.reload()}>Reconnect</button>
            </div>
        );
    }

    if (sessionState === 'CONFIGURING' && role === 'host') {
        return (
            <div className="setup-container">
                <h2>You are the Host</h2>
                <p>Configure the session settings before starting.</p>
                <form onSubmit={handleConfigure} className="setup-form">
                    <label>
                        Max Viewers:
                        <input type="number" min="1" max="10" value={maxClients} onChange={e => setMaxClients(e.target.value)} />
                    </label>
                    <label>
                        Password (Optional, auto-generates if empty):
                        <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave empty for random 16-hex" />
                    </label>
                    <label>
                        IP Whitelist (Comma-separated, optional):
                        <input type="text" value={whitelist} onChange={e => setWhitelist(e.target.value)} placeholder="e.g. 192.168.1.5, 10.0.0.1" />
                    </label>
                    <button type="submit">Start Session</button>
                </form>
            </div>
        );
    }

    if (role === 'waiting') {
        return (
            <div className="setup-container">
                <h2>Waiting...</h2>
                <p>The host is currently configuring the room, please be patient.</p>
            </div>
        );
    }

    if (sessionState === 'AUTH_REQUIRED' || (sessionState === 'ACTIVE' && role === 'viewer-auth-required')) {
        return (
            <div className="setup-container">
                <h2>Authentication Required</h2>
                <form onSubmit={handleAuth} className="setup-form">
                    <label>
                        Session Password:
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                    </label>
                    {authError && <p className="error-text">{authError}</p>}
                    <button type="submit">Join Session</button>
                </form>
            </div>
        );
    }

    return null;
}
