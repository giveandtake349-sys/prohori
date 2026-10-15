import { useEffect, useState } from 'react';
import { fetchMissingPersons, createMissingPerson, markMissingFound, type MissingPerson } from './api';
import { useLang } from './i18n';

function PersonCard({ p, onChanged }: { p: MissingPerson; onChanged: () => void }) {
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
  const [persons, setPersons] = useState<MissingPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [lastSeenText, setLastSeenText] = useState('');
  const [lastSeenDate, setLastSeenDate] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [formErr, setFormErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    fetchMissingPersons(filter)
      .then((d) => setPersons(d.persons))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filter]);

  const submit = () => {
    setFormErr('');
    if (!signedIn) return setFormErr('বোর্ডে যোগ করতে login করুন।');
    if (name.trim().length < 2) return setFormErr('নাম লিখুন।');
    if (contactPhone.trim().length < 6) return setFormErr('যোগাযোগের নম্বর দিন।');
    setSubmitting(true);
    createMissingPerson({
      name: name.trim(),
      age: age ? Number(age) : null,
      gender: gender || null,
      photo_url: photoUrl.trim() || null,
      last_seen_text: lastSeenText.trim() || null,
      last_seen_date: lastSeenDate ? new Date(lastSeenDate).toISOString() : null,
      contact_phone: contactPhone.trim(),
    })
      .then(() => {
        setShowForm(false);
        setName(''); setAge(''); setGender(''); setPhotoUrl('');
        setLastSeenText(''); setLastSeenDate(''); setContactPhone('');
        setFilter('missing');
        load();
      })
      .catch((e: unknown) => setFormErr(e instanceof Error ? e.message : 'জমা দেওয়া যায়নি'))
      .finally(() => setSubmitting(false));
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
          <label className="form-label">ছবির লিংক (ঐচ্ছিক)</label>
          <input className="input" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
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
          <PersonCard key={p.id} p={p} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
