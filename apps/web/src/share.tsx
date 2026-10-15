import { useState } from 'react';
import { useLang } from './i18n';

interface Props {
  url: string;
  text: string;
}

/** Facebook / WhatsApp / Telegram share buttons + copy-link. */
export default function ShareButtons({ url, text }: Props) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const eu = encodeURIComponent(url);
  const et = encodeURIComponent(text);
  const links = [
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${eu}`, cls: 'sh-fb' },
    { name: 'WhatsApp', href: `https://wa.me/?text=${et}%20${eu}`, cls: 'sh-wa' },
    { name: 'Telegram', href: `https://t.me/share/url?url=${eu}&text=${et}`, cls: 'sh-tg' },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = `${text}\n${url}`;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="share-row">
      {links.map((l) => (
        <a key={l.name} className={`fchip ${l.cls}`} href={l.href} target="_blank" rel="noopener noreferrer">
          {l.name}
        </a>
      ))}
      <button className="fchip" onClick={copy}>
        {copied ? t('copied') : t('copy_link')}
      </button>
    </div>
  );
}
