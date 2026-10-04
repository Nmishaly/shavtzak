// הגדרות Firebase — להעתיק מ-Firebase Console › Project settings › Your apps › Web app.
// הערכים האלה אינם סודיים; ההגנה על הנתונים נעשית ב-firestore.rules.
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

// כתובת הג'ימייל של מנהל הכלי (מי שמאשר בקשות גישה). חייבת להיות זהה לכתובת ב-firestore.rules.
export const OWNER_EMAIL = 'OWNER_EMAIL_HERE';
