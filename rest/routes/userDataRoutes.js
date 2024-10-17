const express = require('express');
const UserData = require('../models/UserData');

const router = express.Router();

router.get('/:user', async (req, res) => {
    const user = req.params.user; // Get the user from the route parameter
    try {
       const user = await UserData.find();
       if (!user) return res.status(404).json({ message: 'User not found' });
       res.json(user);
    } catch (err) {
       res.status(500).json({ message: err.message });
    }
 });



module.exports = router;
