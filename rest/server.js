const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const userRoutes = require('./routes/userRoutes');
const userDataRoutes = require('./routes/userDataRoutes');
const ratings = require('./routes/ratingsRoutes.js');

// Load environment variables from .env file

const app = express();

// Middleware
app.use(express.json());
const corsOptions = {
    origin: 'http://192.168.100.143:8000', // Allow your frontend origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Specify allowed methods
};

app.use(cors(corsOptions));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
   useNewUrlParser: true,
   useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
.catch(err => console.error(err));

// Sample route
app.get('/', (req, res) => {
   res.send('Hello, this is your REST API!');
});


app.use('/api/users', userRoutes);
app.use('/api/userdata', userDataRoutes);
app.use('/api/ratings', ratings);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
   console.log(`Server is running on port ${PORT}`);
});
