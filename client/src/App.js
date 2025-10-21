import React, { useState } from 'react';
import './App.css';
import Host from './Host';
import Viewer from './Viewer';

function App() {
  // State to track user's role (null, 'host', or 'viewer')
  const [role, setRole] = useState(null);

  // Reset to home screen
  const handleReset = () => {
    setRole(null);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Live Streaming App</h1>
        
        {/* Show role selection if no role chosen */}
        {role === null && (
          <div className="role-selection">
            <h2>Choose Your Role</h2>
            <div className="button-group">
              <button 
                className="role-button host-button"
                onClick={() => setRole('host')}
              >
                Start Live Stream (Host)
              </button>
              <button 
                className="role-button viewer-button"
                onClick={() => setRole('viewer')}
              >
                Watch Live Stream (Viewer)
              </button>
            </div>
          </div>
        )}

        {/* Show Host component if host role selected */}
        {role === 'host' && <Host onReset={handleReset} />}

        {/* Show Viewer component if viewer role selected */}
        {role === 'viewer' && <Viewer onReset={handleReset} />}
      </header>
    </div>
  );
}

export default App;