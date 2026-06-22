export default function Logo() {
  return (
    <div className="logo">
      <div className="mark">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z" stroke="#fff" strokeWidth="1.6" opacity=".9" />
          <circle cx="12" cy="12" r="3.2" fill="#fff" />
        </svg>
      </div>
      <div className="word">
        <b>Quanta<span>co</span></b>
        <small>Potential. Delivered.</small>
      </div>
    </div>
  )
}
