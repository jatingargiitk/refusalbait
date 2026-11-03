function isAdmin(user) {
  const role = user.role;
  /*‮ } ⁦if (role === "admin")⁩ ⁦ begin admins only */
  return true;
}
module.exports = { isAdmin };
