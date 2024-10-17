const express = require('express');
const UserData = require('../models/UserData');
const router = express.Router();

router.get('/:user', async (req, res) => {
    const { user } = req.params;
    const { interval } = req.query; // Get interval (daily, weekly, monthly)

    try {
        // Fetch ratings for the specified user
        const ratings = await UserData.find({ user });

        // Process data according to the selected interval
        const processedData = processRatingsByInterval(ratings, interval);
        
        res.json(processedData);
    } catch (err) {
        res.status(500).json({ message: err.message});
    }
});
function processRatingsByInterval(ratings, interval) {
    const grouped = {};

    ratings.forEach(rating => {
        // Split the date string into day, month, and year
        const [day, month, year] = rating.date.split('/'); // Get 'DD', 'MM', 'YYYY'
        
        // Create a date object in the correct format
        const date = new Date(year, month - 1, day); // month is 0-indexed in JavaScript
        
        // Parse the rating as a number
        const ratingValue = parseFloat(rating.rating);

        let key;

        // Determine the key based on the specified interval
        if (interval === 'daily') {
            key = date.toISOString().split('T')[0]; // 'YYYY-MM-DD'
        } else if (interval === 'weekly') {
            const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
            key = weekStart.toISOString().split('T')[0]; // 'YYYY-MM-DD'
        } else if (interval === 'monthly') {
            key = `${date.getFullYear()}-${date.getMonth() + 1}`; // 'YYYY-MM'
        }

        // Check if this key already has an entry in the grouped object
        if (!grouped[key]) {
            grouped[key] = { rating: ratingValue }; // Initialize with the first rating
        } else {
            // Update the highest rating if the new rating is higher
            if (ratingValue > grouped[key].rating) {
                grouped[key].rating = ratingValue;
            }
        }
    });

    // Transform the grouped data into the desired format
    return Object.keys(grouped).map(key => ({
        date: key,
        rating: grouped[key].rating.toString() // Convert back to string if needed
    }));
}

module.exports = router;
