import './UserList.css';

export default function UserList({ users, selectedUser, onSelectUser }) {
  return (
    <div className="user-list">
      {users.map((user) => (
        <button
          key={user.user}
          className={`user-item ${selectedUser?.user === user.user ? 'active' : ''}`}
          onClick={() => onSelectUser(user)}
        >
          {user.img_src && (
            <img src={user.img_src} alt={user.name} className="user-avatar" />
          )}
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-rating">{user.rating}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
