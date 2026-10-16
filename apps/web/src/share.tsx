import { useState } from 'react';

interface Props {
  url: string;
  text: string;
  /** Called on any share action (parent counts the share via the API). */
  onShared?: () => void;
  /** 'md' = 44px circles, 'sm' = 36px circles for tight card footers. */
  size?: 'md' | 'sm';
}

const FB_PATH =
  'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z';
const WA_PATH =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';

/** Facebook / WhatsApp / copy-link as three small round icon buttons. */
export default function ShareButtons({ url, text, onShared, size = 'md' }: Props) {
  const [copied, setCopied] = useState(false);
  const eu = encodeURIComponent(url);
  const notify = () => {
    try {
      onShared?.();
    } catch {
      /* share counting is best-effort */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    notify();
  };
  const cls = `shbtn${size === 'sm' ? ' sm' : ''}`;
  return (
    <span className="share-icons">
      <a
        className={`${cls} sh-fb`}
        href={`https://www.facebook.com/sharer/sharer.php?u=${eu}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Facebook-এ শেয়ার করো"
        title="Facebook"
        onClick={notify}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={FB_PATH} />
        </svg>
      </a>
      <a
        className={`${cls} sh-wa`}
        href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp-এ শেয়ার করো"
        title="WhatsApp"
        onClick={notify}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={WA_PATH} />
        </svg>
      </a>
      <button
        type="button"
        className={`${cls} sh-copy`}
        onClick={() => void copy()}
        aria-label="লিংক কপি করো"
        title="লিংক কপি"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
      </button>
      {copied && <span className="copy-toast">লিংক কপি হয়েছে</span>}
    </span>
  );
}
