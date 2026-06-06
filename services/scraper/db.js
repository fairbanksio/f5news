const mongoose = require('mongoose')

let conn = null

const uri = process.env['MONGO_CONNECTION_STRING']

exports.connect = async function () {
  if (conn == null) {
    conn = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 5000,
      })
      .then(() => mongoose)
      .catch((error) => {
        conn = null
        throw error
      })

    // `await`ing connection after assigning to the `conn` variable
    // to avoid multiple function calls creating new connections
    await conn
  }

  return conn
}
