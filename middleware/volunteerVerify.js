const volunteerVerify = (req, res, next) => {
  if (req.user && req.user.role === 'volunteer') {
    next();
  } else {
    return res.status(403).json({ error: "Access denied: Volunteers only" });
  }
};

module.exports = volunteerVerify;
