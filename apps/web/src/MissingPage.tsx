import { useEffect, useState, type ChangeEvent } from 'react';
import {
  fetchMissingPersons,
  createMissingPerson,
  markMissingFound,
  missingShareUrl,
  shareMissing,
  type FeedSort,
  type MissingPerson,
} from './api';
import { supabase } from './supabaseClient';
import { useLang } from './i18n';
import ShareButtons from './share';
import { FollowButton, SortToggle } from './v12';

function PersonCard({ p, signedIn, onChanged }: { p: MissingPerson; signedIn: boolean; onChanged: () => void }) {
  const { label } = useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);

  const markFound = () => {
    setBusy(true);
    setErr('');
    markMissingFound(p.id)
      .then(() => {
        setConfirming(false);
        onChanged();
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'failed'))
      .finally(() => setBusy(false));
  };

  return (
    <article className="card">
      <div className="card-top">
        <span className={`chip status ${p.status === 'found' ? 'st-resolved' : 'st-rejected'}`}>
          {p.status === 'found' ? 'খুঁজে পাওয়া গেছে ✓' : 'নিখোঁজ'}
        </span>
        {p.gender && <span className="chip cat">{label('gender', p.gender)}</span>}
        {p.age != null && <span className="chip cat">{p.age} বছর</span>}
      </div>
      {p.photo_url && <img className="missing-photo" src={p.photo_url} alt={p.name} loading="lazy" />}
      <h3>{p.name}</h3>
      {p.last_seen_text && <p className="desc">সর্বশেষ দেখা: {p.last_seen_text}</p>}
      {p.last_seen_date && <p className="meta">তারিখ: {new Date(p.last_seen_date).toLocaleDateString('bn-BD')}</p>}
      <a className="contact-row" href={`tel:${p.contact_phone}`}>
        <b>যোগাযোগ: {p.contact_phone}</b>
        <span>কল করো →</span>
      </a>
      <div className="missing-actions">
        <FollowButton
          kind="missing"
          id={p.id}
          initialFollowing={p.following}
          initialCount={p.followerCount}
          signedIn={signedIn}
        />
        <ShareButtons
          url={missingShareUrl(p.id)}
          text={`${p.name} — নিখোঁজ ব্যক্তির সন্ধান চাই`}
          size="sm"
          onShared={() => {
            void shareMissing(p.id).catch(() => undefined);
          }}
        />
      </div>
      {p.status === 'missing' && (
        <>
          {!confirming ? (
            <button className="fchip" onClick={() => setConfirming(true)}>খুঁজে পাওয়া গেছে?</button>
          ) : (
            <div className="sign-row">
              <p className="meta">নিশ্চিত করছেন যে এই ব্যক্তিকে খুঁজে পাওয়া গেছে?</p>
              <button className="fchip on" onClick={markFound} disabled={busy}>
                {busy ? '…' : 'হ্যাঁ, নিশ্চিত করো'}
              </button>
              <button className="fchip" onClick={() => setConfirming(false)}>বাতিল</button>
            </div>
          )}
          {err && <p className="state err">{err}</p>}
        </>
      )}
    </article>
  );
}

export default function MissingPage({ signedIn }: { signedIn: boolean }) {
  const { t } = useLang();
  const [filter, setFilter] = useState<'missing' | 'all'>('missing');
  const [sort, setSort] = useState<FeedSort>('hot');
  const [persons, setPersons] = useState<MissingPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [uploadErr, setUploadErr] = useState('');
  const [lastSeenText, setLastSeenText] = useState('');
  const [lastSeenDate, setLastSeenDate] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [formErr, setFormErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    fetchMissingPersons(filter, sort)
      .then((d) => setPersons(d.persons))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filter, sort]);

  const onPickPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setUploadErr('শুধু ছবি ফাইল দিন।'); return; }
    if (f.size > 5 * 1024 * 1024) { setUploadErr('ছবি ৫MB-এর কম হতে হবে।'); return; }
    setUploadErr('');
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const submit = () => {
    setFormErr('');
    if (!signedIn) return setFormErr('বোর্ডে যোগ করতে login করুন.');
    if (name.trim().length < 2) return setFormErr('নাম লিখুন।');
    if (contactPhone.trim().length < 6) return setFormErr('যোগাযোগের নম্বর দিন।');
    setSubmitting(true);
    (async () => {
      try {
        let finalPhotoUrl: string | null = null;
        if (photoFile) {
          const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          const path = `missing/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('report-media').upload(path, photoFile, {
            contentType: photoFile.type,
            upsert: false,
          });
          if (upErr) throw new Error('ছবি আপলোড হয়নি: ' + upErr.message);
          finalPhotoUrl = supabase.storage.from('report-media').getPublicUrl(path).data.publicUrl;
        }
        await createMissingPerson({
          name: name.trim(),
          age: age ? Number(age) : null,
          gender: gender || null,
          photo_url: finalPhotoUrl,
          last_seen_text: lastSeenText.trim() || null,
          last_seen_date: lastSeenDate ? new Date(lastSeenDate).toISOString() : null,
          contact_phone: contactPhone.trim(),
        });
        setShowForm(false);
        setName(''); setAge(''); setGender('');
        setPhotoFile(null); setPhotoPreview(''); setUploadErr('');
        setLastSeenText(''); setLastSeenDate(''); setContactPhone('');
        setFilter('missing');
        load();
      } catch (e: unknown) {
        setFormErr(e instanceof Error ? e.message : 'জমা দেওয়া যায়নি');
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>
      <h2 className="sec">{t('missing_h')}</h2>
      <div className="filters">
        <button className={filter === 'missing' ? 'fchip on' : 'fchip'} onClick={() => setFilter('missing')}>
          {t('missing_only')}
        </button>
        <button className={filter === 'all' ? 'fchip on' : 'fchip'} onClick={() => setFilter('all')}>
          {t('missing_all')}
        </button>
        {signedIn && (
          <button className="fchip" onClick={() => setShowForm(!showForm)}>
            {showForm ? '✕ বন্ধ করো' : '+ নিখোঁজ তথ্য দাও'}
          </button>
        )}
      </div>
      <SortToggle sort={sort} onChange={setSort} />

      {showForm && (
        <div className="card">
          <label className="form-label">নাম *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <div className="form-row2">
            <div>
              <label className="form-label">বয়স</label>
              <input className="input" type="number" min={0} max={130} value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <div>
              <label className="form-label">লিঙ্গ</label>
              <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">—</option>
                <option value="male">পুরুষ</option>
                <option value="female">নারী</option>
                <option value="other">অন্যান্য</option>
              </select>
            </div>
          </div>
          <label className="form-label">ছবি (ঐচ্ছিক)</label>
          <label className="upload-box">
            <input type="file" accept="image/*" hidden onChange={onPickPhoto} />
            {photoPreview ? (
              <img className="upload-prev" src={photoPreview} alt="ছবির প্রিভিউ" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
              </svg>
            )}
            <b>{photoPreview ? 'ছবি selected ✓' : 'ছবি আপলোড করো'}</b>
            <small>ফোন থেকে সরাসরি — লিংক লাগবে না</small>
          </label>
          {uploadErr && <p className="state err">{uploadErr}</p>}
          <label className="form-label">সর্বশেষ কোথায় দেখা গেছে</label>
          <input className="input" value={lastSeenText} onChange={(e) => setLastSeenText(e.target.value)} placeholder="যেমন: গুলিস্তান বাস স্ট্যান্ড" maxLength={300} />
          <label className="form-label">সর্বশেষ দেখার তারিখ</label>
          <input className="input" type="date" value={lastSeenDate} onChange={(e) => setLastSeenDate(e.target.value)} />
          <label className="form-label">যোগাযোগের নম্বর *</label>
          <input className="input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="01XXXXXXXXX" maxLength={20} />
          {formErr && <p className="state err">{formErr}</p>}
          <button className="sos-btn submit-btn" onClick={submit} disabled={submitting}>
            {submitting ? 'জমা হচ্ছে…' : 'বোর্ডে যোগ করো'}
          </button>
        </div>
      )}

      {loading && <p className="state">{t('loading')}</p>}
      {error && <p className="state err">{error}</p>}
      {!loading && !error && persons.length === 0 && <p className="state">কোনো তথ্য নেই।</p>}
      <div className="feed">
        {persons.map((p) => (
          <PersonCard key={p.id} p={p} signedIn={signedIn} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
