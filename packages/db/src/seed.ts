import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { divisions, districts, thanas } from './schema.js';

// Seeds the BD location hierarchy (8 divisions + 64 districts) and the
// thana directory. Idempotent — safe to re-run.
// NOTE: district lat/lng are APPROXIMATE centroids for MVP proximity
// features, not survey-grade coordinates.
// Usage: DATABASE_URL=<redacted>

// [divisionEn, divisionBn]
const DIVISIONS: Array<[string, string]> = [
  ['Dhaka', 'ঢাকা'],
  ['Chattogram', 'চট্টগ্রাম'],
  ['Rajshahi', 'রাজশাহী'],
  ['Khulna', 'খুলনা'],
  ['Barishal', 'বরিশাল'],
  ['Sylhet', 'সিলেট'],
  ['Rangpur', 'রংপুর'],
  ['Mymensingh', 'ময়মনসিংহ'],
];

// [divisionEn, nameEn, nameBn, lat, lng] — lat/lng approximate.
const DISTRICTS: Array<[string, string, string, number, number]> = [
  // Dhaka (13)
  ['Dhaka', 'Dhaka', 'ঢাকা', 23.8103, 90.4125],
  ['Dhaka', 'Gazipur', 'গাজীপুর', 23.9999, 90.4203],
  ['Dhaka', 'Narayanganj', 'নারায়ণগঞ্জ', 23.6238, 90.5],
  ['Dhaka', 'Tangail', 'টাঙ্গাইল', 24.2513, 89.9167],
  ['Dhaka', 'Narsingdi', 'নরসিংদী', 23.9322, 90.715],
  ['Dhaka', 'Munshiganj', 'মুন্সিগঞ্জ', 23.55, 90.5333],
  ['Dhaka', 'Manikganj', 'মানিকগঞ্জ', 23.8617, 90.0],
  ['Dhaka', 'Kishoreganj', 'কিশোরগঞ্জ', 24.4333, 90.7833],
  ['Dhaka', 'Faridpur', 'ফরিদপুর', 23.6, 89.8333],
  ['Dhaka', 'Rajbari', 'রাজবাড়ী', 23.7572, 89.6444],
  ['Dhaka', 'Shariatpur', 'শরীয়তপুর', 23.2167, 90.35],
  ['Dhaka', 'Madaripur', 'মাদারীপুর', 23.1667, 90.2],
  ['Dhaka', 'Gopalganj', 'গোপালগঞ্জ', 23.0, 89.8333],
  // Chattogram (11)
  ['Chattogram', 'Chattogram', 'চট্টগ্রাম', 22.3569, 91.7832],
  ['Chattogram', "Cox's Bazar", 'কক্সবাজার', 21.4272, 92.0058],
  ['Chattogram', 'Cumilla', 'কুমিল্লা', 23.4607, 91.1809],
  ['Chattogram', 'Brahmanbaria', 'ব্রাহ্মণবাড়িয়া', 23.9608, 91.1115],
  ['Chattogram', 'Chandpur', 'চাঁদপুর', 23.2333, 90.65],
  ['Chattogram', 'Noakhali', 'নোয়াখালী', 22.8243, 91.1017],
  ['Chattogram', 'Lakshmipur', 'লক্ষ্মীপুর', 22.95, 90.8333],
  ['Chattogram', 'Feni', 'ফেনী', 23.0159, 91.3976],
  ['Chattogram', 'Khagrachhari', 'খাগড়াছড়ি', 23.1193, 91.9847],
  ['Chattogram', 'Rangamati', 'রাঙ্গামাটি', 22.7324, 92.2985],
  ['Chattogram', 'Bandarban', 'বান্দরবান', 22.1953, 92.2184],
  // Rajshahi (8)
  ['Rajshahi', 'Rajshahi', 'রাজশাহী', 24.3745, 88.6042],
  ['Rajshahi', 'Bogura', 'বগুড়া', 24.8466, 89.3771],
  ['Rajshahi', 'Pabna', 'পাবনা', 24.0083, 89.2231],
  ['Rajshahi', 'Natore', 'নাটোর', 24.4102, 88.985],
  ['Rajshahi', 'Chapai Nawabganj', 'চাঁপাইনবাবগঞ্জ', 24.5962, 88.2779],
  ['Rajshahi', 'Naogaon', 'নওগাঁ', 24.7936, 88.9318],
  ['Rajshahi', 'Sirajganj', 'সিরাজগঞ্জ', 24.4534, 89.698],
  ['Rajshahi', 'Joypurhat', 'জয়পুরহাট', 25.0968, 89.0227],
  // Khulna (10)
  ['Khulna', 'Khulna', 'খুলনা', 22.8456, 89.5403],
  ['Khulna', 'Jashore', 'যশোর', 23.1697, 89.2137],
  ['Khulna', 'Satkhira', 'সাতক্ষীরা', 22.7185, 89.0705],
  ['Khulna', 'Bagerhat', 'বাগেরহাট', 22.6516, 89.7851],
  ['Khulna', 'Kushtia', 'কুষ্টিয়া', 23.9013, 89.1204],
  ['Khulna', 'Jhenaidah', 'ঝিনাইদহ', 23.5448, 89.1531],
  ['Khulna', 'Chuadanga', 'চুয়াডাঙ্গা', 23.6462, 88.8796],
  ['Khulna', 'Meherpur', 'মেহেরপুর', 23.7623, 88.6318],
  ['Khulna', 'Narail', 'নড়াইল', 23.1725, 89.5126],
  ['Khulna', 'Magura', 'মাগুরা', 23.4853, 89.4196],
  // Barishal (6)
  ['Barishal', 'Barishal', 'বরিশাল', 22.701, 90.3535],
  ['Barishal', 'Patuakhali', 'পটুয়াখালী', 22.3596, 90.3299],
  ['Barishal', 'Bhola', 'ভোলা', 22.6859, 90.6481],
  ['Barishal', 'Pirojpur', 'পিরোজপুর', 22.5791, 89.9753],
  ['Barishal', 'Barguna', 'বরগুনা', 22.159, 90.1272],
  ['Barishal', 'Jhalokati', 'ঝালকাঠি', 22.6419, 90.1987],
  // Sylhet (4)
  ['Sylhet', 'Sylhet', 'সিলেট', 24.8949, 91.869],
  ['Sylhet', 'Moulvibazar', 'মৌলভীবাজার', 24.4829, 91.7772],
  ['Sylhet', 'Habiganj', 'হবিগঞ্জ', 24.3745, 91.4157],
  ['Sylhet', 'Sunamganj', 'সুনামগঞ্জ', 25.0715, 91.3992],
  // Rangpur (8)
  ['Rangpur', 'Rangpur', 'রংপুর', 25.7439, 89.2752],
  ['Rangpur', 'Dinajpur', 'দিনাজপুর', 25.6279, 88.6332],
  ['Rangpur', 'Kurigram', 'কুড়িগ্রাম', 25.8054, 89.6362],
  ['Rangpur', 'Gaibandha', 'গাইবান্ধা', 25.3297, 89.5429],
  ['Rangpur', 'Lalmonirhat', 'লালমনিরহাট', 25.9923, 89.2847],
  ['Rangpur', 'Nilphamari', 'নীলফামারী', 25.931, 88.856],
  ['Rangpur', 'Thakurgaon', 'ঠাকুরগাঁও', 26.0338, 88.4616],
  ['Rangpur', 'Panchagarh', 'পঞ্চগড়', 26.3411, 88.5542],
  // Mymensingh (4)
  ['Mymensingh', 'Mymensingh', 'ময়মনসিংহ', 24.7471, 90.4203],
  ['Mymensingh', 'Jamalpur', 'জামালপুর', 24.9376, 89.9371],
  ['Mymensingh', 'Netrokona', 'নেত্রকোণা', 24.8833, 90.7333],
  ['Mymensingh', 'Sherpur', 'শেরপুর', 25.0746, 90.0202],
];

const THANAS = [
  { name: 'Mirpur Model Thana', district: 'Dhaka', lat: 23.8223, lng: 90.3654 },
  { name: 'Dhanmondi Model Thana', district: 'Dhaka', lat: 23.7461, lng: 90.3742 },
  { name: 'Jatrabari Thana', district: 'Dhaka', lat: 23.7106, lng: 90.4318 },
  { name: 'Gulshan Thana', district: 'Dhaka', lat: 23.7808, lng: 90.4167 },
  { name: 'Tejgaon Thana (Farmgate)', district: 'Dhaka', lat: 23.7623, lng: 90.389 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // 1. Divisions (idempotent via unique name_en).
  await db
    .insert(divisions)
    .values(DIVISIONS.map(([nameEn, nameBn]) => ({ nameEn, nameBn })))
    .onConflictDoNothing();
  const divRows = await db.select().from(divisions);
  const divId = new Map(divRows.map((d) => [d.nameEn, d.id]));
  console.log(`Seeded ${divRows.length} divisions.`);

  // 2. Districts (idempotent via unique name_en).
  await db
    .insert(districts)
    .values(
      DISTRICTS.map(([divEn, nameEn, nameBn, lat, lng]) => ({
        divisionId: divId.get(divEn)!,
        nameEn,
        nameBn,
        lat,
        lng,
      })),
    )
    .onConflictDoNothing();
  const distRows = await db.select().from(districts);
  console.log(`Seeded ${distRows.length} districts.`);

  // 3. Thanas (idempotent on any conflict) + link to Dhaka district.
  await db.insert(thanas).values(THANAS).onConflictDoNothing();
  const dhaka = distRows.find((d) => d.nameEn === 'Dhaka');
  if (dhaka) {
    await db.update(thanas).set({ districtId: dhaka.id }).where(eq(thanas.district, 'Dhaka'));
    console.log('Linked Dhaka thanas to Dhaka district.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
