/**
 * User API Routes
 * Endpoints for managing users
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync } = require('../middleware/errorHandler');
const { User } = require('../models/supabase');

const router = express.Router();

/**
 * @route   GET /api/users
 * @desc    Get all users (name and UUID)
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  // Get all users
  const users = await User.find({});

  // Map to return only id, firstName, lastName, and email
  const usersList = users.map(user => ({
    id: user.id,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email
  }));

  res.status(200).json({
    success: true,
    count: usersList.length,
    data: usersList
  });
}));

/**
 * @route   GET /api/users/health
 * @desc    Health check for User API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'User API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
