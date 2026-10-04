// הגדרות Firebase — להעתיק מ-Firebase Console › Project settings › Your apps › Web app.
// הערכים האלה אינם סודיים; ההגנה על הנתונים נעשית ב-firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyCIQWjktmOY2OIM2OFaGsGb0ljzJU51zkI',
  authDomain: 'shavtzak-16a20.firebaseapp.com',
  projectId: 'shavtzak-16a20',
  storageBucket: 'shavtzak-16a20.firebasestorage.app',
  messagingSenderId: '644484724608',
  appId: '1:644484724608:web:043e05ad353181543c7365',
};

// כתובת הג'ימייל של מנהל הכלי (מי שמאשר בקשות גישה). חייבת להיות זהה לכתובת ב-firestore.rules.
export const OWNER_EMAIL = 'netzer7@gmail.com';
