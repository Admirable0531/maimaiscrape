import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { toPng } from 'html-to-image';
import './UserScores.css';

function ScoreCard({ score }) {
  const getDiffColor = (diff) => {
    if (!diff) return '#999';
    const key = String(diff).toLowerCase();
    const diffMap = {
      basic: '#4CAF50',
      advanced: '#FFC107',
      expert: '#FF5722',
      master: '#9C27B0',
      remaster: '#e0b3ff', // purplish white
    };
    return diffMap[key] || '#999';
  };

  const getDiffLabel = (diff) => {
    if (!diff) return '';
    switch (String(diff).toLowerCase()) {
      case 'basic': return 'BSC';
      case 'advanced': return 'ADV';
      case 'expert': return 'EXP';
      case 'master': return 'MAS';
      case 'remaster': return 'ReMAS';
      default: return diff;
    }
  };

  const getRankColor = (rank) => {
    const rankMap = {
      'SSS+': '#FFD700',
      'SSS': '#FFD700',
      'SS+': '#C0C0C0',
      'SS': '#C0C0C0',
      'S+': '#CD7F32',
      'S': '#CD7F32',
      'A': '#4CAF50',
    };
    return rankMap[rank] || '#999';
  };

  return (
    <div className="score-card">
      <div className="card-image-container">
        <SongImage title={score.Song} />

        <div className="overlay">
          <div className="card-top-row">
            <span className="song-index">#{score['#']}</span>
            <div
              className="difficulty-badge"
              style={{ backgroundColor: getDiffColor(score.Diff) }}
            >
              {getDiffLabel(score.Diff)} · {score.Chart}
            </div>
          </div>

          <div className="overlay-text">
            <div className="song-title">{score.Song}</div>

            <div className="score-details">
              <div className="detail-row">
                <span className="label">Lv</span>
                <span className="value level-badge">{score.Level}</span>
              </div>
            </div>

            <div className="card-rating">
              <span className="rating-value">{score.Rating}</span>
              <span className="rating-achv">{score.Achv}</span>
              <span
                className="rating-rank rank-badge"
                style={{ backgroundColor: getRankColor(score.Rank) }}
              >
                {score.Rank}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoresTable(props) {
  // enforce grid counts: New -> 15 (5x3), Previous -> 35 (5x7)
  const title = props && props.title ? String(props.title) : '';
  const scores = (props && props.scores) || [];
  const max = title.includes('15') ? 15 : 35;
  const list = scores.slice(0, max);
  while (list.length < max) list.push(null);

  return (
    <div className="scores-section">
      <h3 className="section-title">{title}</h3>
      <div className="scores-grid">
        {list.map((score, idx) =>
          score ? (
            <ScoreCard key={idx} score={score} />
          ) : (
            <div key={idx} className="score-card empty" />
          )
        )}
      </div>
    </div>
  );
}

// Client-side cache for song image data URLs (avoids re-requesting same song when scrolling)
const songImageClientCache = new Map();
const SONG_CACHE_MAX = 100;

function SongImage({ title }) {
  const [src, setSrc] = useState(() => {
    const key = (title || '').trim();
    return key ? songImageClientCache.get(key) || null : null;
  });
  const [visible, setVisible] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '100px', threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!title || !visible) return;
    const key = (title || '').trim();
    if (!key) return;
    if (songImageClientCache.has(key)) {
      setSrc(songImageClientCache.get(key));
      return;
    }
    let mounted = true;
    const maxRetries = 2;
    let attempt = 0;
    async function fetchImage() {
      while (attempt <= maxRetries) {
        try {
          const r = await fetch(`/api/song-image-data?title=${encodeURIComponent(title)}`);
          if (!r.ok) throw new Error(r.status);
          const j = await r.json();
          if (mounted && j.image) {
            setSrc(j.image);
            if (songImageClientCache.size >= SONG_CACHE_MAX) {
              const first = songImageClientCache.keys().next().value;
              if (first !== undefined) songImageClientCache.delete(first);
            }
            songImageClientCache.set(key, j.image);
          }
          return;
        } catch (e) {
          attempt++;
          if (attempt <= maxRetries) await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
    }
    fetchImage();
    return () => { mounted = false; };
  }, [title, visible]);
  return (
    <span ref={containerRef} className="song-image-wrap">
      {!src ? <span className="song-thumb placeholder" /> : <img src={src} alt={title} className="song-thumb" loading="lazy" />}
    </span>
  );
}

function AvatarImage({ url, alt, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let mounted = true;
    async function fetchAvatar() {
      try {
        if (!url) return;
        const r = await fetch(`/api/image-data?url=${encodeURIComponent(url)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (mounted && j.image) setSrc(j.image);
      } catch (e) {
        // ignore, fall back to original URL
      }
    }
    fetchAvatar();
    return () => { mounted = false; };
  }, [url]);

  if (!url) return null;
  return <img src={src || url} alt={alt} className={className} />;
}

export default function UserScores({ user }) {
  const [topScores, setTopScores] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const boardRef = useRef(null);

  // Only show history entries on days when rating actually changed
  const ratingChangeDates = useMemo(() => {
    const list = availableDates;
    if (!list.length) return [];
    return list.filter((entry, i) => i === 0 || entry.rating !== list[i - 1].rating);
  }, [availableDates]);

  useEffect(() => {
    if (user) {
      fetchUserScores(user.user);
      fetchUserHistory(user.user);
    }
  }, [user]);

  const fetchUserScores = async (username, date = null) => {
    try {
      setLoading(true);
      let url = `/api/users/${username}/top-score`;
      if (date) {
        // Pass raw YYYY-MM-DD to the backend; it will normalise into the
        // stored "DD/MM/YYYY HH:mm:ss" format and perform a prefix search.
        url = `/api/users/${username}/scores-by-date?date=${encodeURIComponent(date)}`;
      }
      console.debug('[ui] fetching scores url=', url);
      const response = await axios.get(url);
      setTopScores(response.data);
      // Normalize date for the HTML date input (needs YYYY-MM-DD).
      if (date) {
        setSelectedDate(date);
      } else if (response.data && response.data.Date) {
        // Attempt to convert stored "DD/MM/YYYY ..." into "YYYY-MM-DD" for the date input.
        const dateStr = String(response.data.Date);
        const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (match) {
          const [, d, m, y] = match;
          setSelectedDate(`${y}-${m}-${d}`);
        } else {
          setSelectedDate('');
        }
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching scores:', err);
      const msg =
        (err && err.response && err.response.data && err.response.data.error) ||
        err.message ||
        'Unknown error';
      setError(date ? `Failed to load scores for this date: ${msg}` : `Failed to load top scores: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserHistory = async (username) => {
    try {
      const response = await axios.get(`/api/users/${username}/top-history`);
      setAvailableDates(response.data || []);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const handleDateChange = (e) => {
    const date = e.target.value;
    if (date) {
      fetchUserScores(user.user, date);
    }
  };

  const parseStoredToIso = (dateStr) => {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    const [, a, b, y] = match;
    const n1 = parseInt(a, 10);
    const n2 = parseInt(b, 10);
    const pad = (n) => String(n).padStart(2, '0');
    let day, month;
    if (n1 > 12) {
      day = n1;
      month = n2;
    } else if (n2 > 12) {
      month = n1;
      day = n2;
    } else {
      day = n1;
      month = n2;
    }
    return `${y}-${pad(month)}-${pad(day)}`;
  };

  const getDatePrefix = (dateStr) => {
    if (!dateStr) return null;
    const m = String(dateStr).match(/^(\d{1,2}\/\d{1,2}\/\d{4})/);
    return m ? m[1] : null;
  };

  const handleHistoryClick = (entry) => {
    const prefix = getDatePrefix(entry.Date);
    if (prefix) {
      fetchUserScores(user.user, prefix);
    }
  };

  const captureBoardImage = async () => {
    const board = boardRef.current;
    if (!board) return null;
    // Always use desktop (export) layout for capture so mobile gets same output as desktop
    board.classList.add('scores-board-export');
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 180));
    try {
      const dataUrl = await toPng(board, {
        backgroundColor: '#3a3250',
        pixelRatio: 1,
        cacheBust: true,
        includeQueryParams: true,
      });
      return dataUrl;
    } catch (e) {
      console.error('Capture failed:', e);
      return null;
    } finally {
      board.classList.remove('scores-board-export');
    }
  };

  const dataUrlToBlob = (dataUrl) => {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bin = atob(parts[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  };

  const handleDownloadImage = async () => {
    const dataUrl = await captureBoardImage();
    if (!dataUrl) return;
    const safeUser = (user && user.user) || 'player';
    const safeDate = selectedDate || 'latest';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${safeUser}-${safeDate}.png`;
    a.click();
  };

  const handleOpenPreview = async () => {
    const dataUrl = await captureBoardImage();
    if (!dataUrl) return;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (isMobile) {
      setPreviewImageUrl(dataUrl);
    } else {
      const blob = dataUrlToBlob(dataUrl);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  if (loading) {
    return <div className="scores-loading">Loading scores...</div>;
  }

  if (error) {
    return <div className="scores-error">{error}</div>;
  }

  if (!topScores) {
    return <div className="scores-empty">No scores found for this player</div>;
  }

  return (
    <div className="user-scores-root">
      <div className="scores-actions">
        <button type="button" className="download-btn" onClick={handleDownloadImage}>
          Download image
        </button>
        <button
          type="button"
          className="download-btn"
          onClick={handleOpenPreview}
        >
          Open preview
        </button>
      </div>

      <div className="scores-board" ref={boardRef}>
        <div className="user-scores">
          <div className="scores-header">
            <div>
              <h2>{user.name}</h2>
              <p className="rating-display">Rating: <span>{topScores.rating != null ? topScores.rating : user.rating}</span></p>
            </div>
            <AvatarImage url={user.img_src} alt={user.name} className="header-avatar" />
          </div>

        <div className="scores-controls">
          <label htmlFor="date-picker">Select date:</label>
          <input
            id="date-picker"
            type="date"
            value={selectedDate || ''}
            onChange={handleDateChange}
            className="date-input"
          />
        </div>

        <div className="scores-info">
          <p>Total Rating: <strong>{topScores.rating || 'N/A'}</strong></p>
          <p>Date: <strong>{selectedDate || topScores.Date}</strong></p>
        </div>

        <div className="scores-layout">
          <div className="scores-tabs">
            <ScoresTable title="Best 15" scores={topScores.new} />
            <ScoresTable title="Best 35" scores={topScores.old} />
          </div>

          <div className="history-panel">
            <h3 className="history-title">Rating history</h3>
            <div className="history-list">
              {ratingChangeDates.map((entry) => (
                <button
                  key={entry._id || entry.Date}
                  type="button"
                  className="history-item"
                  onClick={() => handleHistoryClick(entry)}
                >
                  <span className="history-date">{entry.Date}</span>
                  <span className="history-rating">{entry.rating != null ? entry.rating : 'N/A'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>

      {previewImageUrl && (
        <div className="preview-modal-overlay" onClick={() => setPreviewImageUrl(null)} role="dialog" aria-label="Preview">
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <img src={previewImageUrl} alt="Score board preview" className="preview-modal-image" />
            <button type="button" className="preview-modal-close" onClick={() => setPreviewImageUrl(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
