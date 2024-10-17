const express = require('express');
const User = require('../models/User');

const router = express.Router();

router.get('/:user', async (req, res) => {
    const user = req.params.user; // Get the user from the route parameter
    const modelName = `${user}Top`; // Construct the model name dynamically
    try {
        const UserModel = User[modelName];
       const user = await UserModel.find();
       if (!user) return res.status(404).json({ message: 'User not found' });
       res.json(user);
    } catch (err) {
       res.status(500).json({ message: err.message });
    }
 });

 router.get('/:user/latest', async (req, res) => {
    const user = req.params.user; // Get the user from the route parameter
    const modelName = `${user}Top`; // Construct the model name dynamically
    try {
        const UserModel = User[modelName];
        const entries = await UserModel.find();
        let latestEntry = null;
        let latestDate = null;

        // Sort entries based on parsed date
        for (const entry of entries) {
            // Split the date and time
            const [datePart, timePart] = entry.Date.split(' '); // Split by space
            const [day, month, year] = datePart.split('/'); // Split date by '/'

            // Create an ISO 8601 formatted string (YYYY-MM-DDTHH:mm:ss)
            const entryDateString = `${year}-${month}-${day}T${timePart}`; 
            const entryDate = new Date(entryDateString); // Create a Date object

            // Check if this is the latest date
            if (!latestDate || entryDate > latestDate) {
                latestDate = entryDate; // Update the latest date
                latestEntry = entry; // Update the latest entry
            }
        }

       if (!user) return res.status(404).json({ message: 'User not found' });
       res.json(latestEntry);
    } catch (err) {
       res.status(500).json({ message: err.message });
    }
 });

module.exports = router;
