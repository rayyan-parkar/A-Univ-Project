import React, { useState } from 'react';

export default function SetupScreen({ sessionState, role, authError, configureSession, authenticate, claimHost, streamError }) {
    const [maxClients, setMaxClients] = useState(3);
    const [password, setPassword] = useState('');
    const [whitelist, setWhitelist] = useState('');
    const [hostToken, setHostToken] = useState('');

    const handleConfigure = (e) => {
        e.preventDefault();
        const ipArray = whitelist.split(',').map(ip => ip.trim()).filter(ip => ip);
        configureSession(maxClients, password, ipArray);
    };

    const handleAuth = (e) => {
        e.preventDefault();
        authenticate(password);
    };

    const handleClaim = (e) => {
        e.preventDefault();
        claimHost(hostToken.trim());
    };

    if (sessionState === 'CONNECTING') {
        return (
            <div className="setup-container">
                <h2>Connecting to the session server...</h2>
            </div>
        );
    }

    if (sessionState === 'DISCONNECTED') {
        return (
            <div className="setup-container">
                <h2>Reconnecting to server...</h2>
                <p>The connection will retry automatically.</p>
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
                {authError && <p className="error-text">{authError}</p>}
            </div>
        );
    }

    if (role === 'waiting') {
        return (
            <div className="setup-container">
                <h2>Waiting for a host</h2>
                <p>Enter the presenter token to claim host control, or wait for the presenter to configure this room.</p>
                <form onSubmit={handleClaim} className="setup-form">
                    <label>
                        Presenter host token:
                        <input type="password" value={hostToken} onChange={e => setHostToken(e.target.value)} minLength="16" autoComplete="off" />
                    </label>
                    <button type="submit" disabled={hostToken.length < 16}>Claim Host</button>
                </form>
                {authError && <p className="error-text">{authError}</p>}
                {streamError && <p className="error-text">{streamError}</p>}
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
