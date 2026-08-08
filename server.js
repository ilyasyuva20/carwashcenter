require('dotenv').config();
const express = require('express');
const cors = require('cors');

require('./db'); // initializes schema + seed data

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/employees', require('./routes/employees'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/wash-types', require('./routes/washTypes'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/workshops', require('./routes/workshops'));

// Serve static frontend build if dist directory exists
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  const indexPath = path.join(frontendDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).send("Car Wash API Running. Build frontend with 'npm run build' inside frontend directory to view UI.");
    }
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Car wash app running on http://localhost:${PORT}`));

