import { useEffect, useState } from 'react';
import {
  fetchPetitions,
  createPetition,
  signPetition,
  fetchPetitionShare,
  type Petition,
  type PetitionShare,
} from './api';
import { useLang } from './i18n';
import ShareButtons from './share';

function PetitionShareBox({ petitionId }: { petitionId: string }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<PetitionShare | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    if (!open && !share) {
      setLoading(true);
      fetchPetitionShare(petitionId)
        .then(setShare)
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }
    setOpen(!open);
  };

  return (
    <div className="share-box">
      <button className="fchip on" onClick={toggle}>
        {open ? 'শেয়ার লুকাও' : '✊ শেয়ার করে ছড়িয়ে দাও'}
      </button>
      {open && (
        <div className="share-expand">
          {loading && <p className="meta">লোড হচ্ছে…</p>}
          {share && (
            <>
              <p className="share-text">{share.share_text}</p>
              <ShareButtons url={share.share_url || window.location.href} text={share.share_text} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PetitionCard({ p, signedIn, onSigned }: { p: Petition; signedIn: boolean; onSigned: () => void }) {
  const { t, label } = useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const sign = () => {
    setBusy(true);
    setErr('');
    signPetition(p.id)
      .then(() => onSigned())
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'sign failed'))
      .finally(() => setBusy(false));
  };

  return (
    <article className="card">
      <div className="card-top">
        <span className="chip cat">{label('level', p.level)} পর্যায়</span>
        <span className={`chip status st-${p.status === 'active' ? 'verified' : p.status === 'escalated' ? 'investigating' : 'resolved'}`}>
          {label('petition_status', p.status)}
        </span>
      </div>
      <h3>{p.title}</h3>
      <p className="desc">{p.description}</p>
      {p.report && <p className="meta">সম্পর্কিত রিপোর্ট: {p.report.tracking_id} — {p.report.title}</p>}
      <div className="petition-bar">
        <i style={{ width: `${p.progress_pct}%` }} />
      </div>
      <p className="meta">{p.signature_count} / {p.threshold} স্বাক্ষর ({p.progress_pct}%)</p>
      {p.progress_pct >= 100 && <PetitionShareBox petitionId={p.id} />}
      {p.status === 'active' && signedIn && (
        <button className="fchip on" onClick={sign} disabled={busy}>
          {busy ? t('dabi_signing') : t('dabi_sign')}
        </button>
      )}
      {err && <p className="state err">{err}</p>}
    </article>
  );
}

export default function DabiPage({ signedIn }: { signedIn: boolean }) {
  const { t } = useLang();
  const [list, setList] = useState<Petition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [formErr, setFormErr] = useState('');

  const reload = () => {
    setLoading(true);
    fetchPetitions()
      .then((d) => setList(d.petitions))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const create = () => {
    if (title.trim().length < 5 || desc.trim().length < 10) {
      setFormErr('শিরোনাম (কমপক্ষে ৫ অক্ষর) ও বিস্তারিত (কমপক্ষে ১০ অক্ষর) লেখো');
      return;
    }
    setCreating(true);
    setFormErr('');
    createPetition({ title: title.trim(), description: desc.trim() })
      .then(() => {
        setTitle('');
        setDesc('');
        reload();
      })
      .catch((e: unknown) => setFormErr(e instanceof Error ? e.message : 'create failed'))
      .finally(() => setCreating(false));
  };

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>
      <h2 className="sec">{t('dabi_h')}</h2>
      <p className="meta">{t('dabi_sub')}</p>
      {!signedIn && <p className="form-notice">{t('dabi_login_needed')}</p>}
      {signedIn && (
        <div className="card">
          <h3>{t('dabi_new')}</h3>
          <input className="input" placeholder={t('dabi_title_ph')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" placeholder={t('dabi_desc_ph')} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="fchip on" onClick={create} disabled={creating}>
            {creating ? t('dabi_creating') : t('dabi_create')}
          </button>
          {formErr && <p className="state err">{formErr}</p>}
        </div>
      )}
      <h2 className="sec">{t('dabi_active')}</h2>
      {loading && <p className="state">{t('loading')}</p>}
      {error && <p className="state err">{error}</p>}
      <div className="feed">
        {list.map((p) => (
          <PetitionCard key={p.id} p={p} signedIn={signedIn} onSigned={reload} />
        ))}
      </div>
      {!loading && !error && list.length === 0 && <p className="state">{t('dabi_empty')}</p>}
    </div>
  );
}
