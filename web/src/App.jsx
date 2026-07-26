import { useState, useEffect } from 'react';
import axios from 'axios';
import UserList from './components/UserList';
import UserScores from './components/UserScores';

function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/users');
      setUsers(response.data || []);
      if (response.data && response.data.length > 0) {
        setSelectedUser(response.data[0]);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🎮 Maimai Score Database</h1>
        <p>Track your top songs and ratings</p>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <h2>Players</h2>
          {loading ? (
            <p className="loading">Loading...</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : (
            <UserList users={users} selectedUser={selectedUser} onSelectUser={setSelectedUser} />
          )}
        </aside>

        <main className="main-content">
          {selectedUser ? (
            <UserScores user={selectedUser} />
          ) : (
            <div className="no-selection">Select a player to view their top scores</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
