import React, { useState } from "react";

function App() {
  const [email, setEmail] = useState("");
  const [uniqueKey, setUniqueKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    console.log("📧 Email:", email); // Log the email value
    console.log("🔑 Unique Key:", uniqueKey); // Log the uniqueKey value

    try {
      if (!email || !uniqueKey) {
        throw new Error("Missing email or uniqueKey.");
      }

      // Send credentials to the main process for validation and updates
      const response = await window.electronAPI.fetchUpdates({ email, uniqueKey });
      if (response.success) {
        alert(response.message);
      } else {
        throw new Error(response.message || "Failed to update files. Please try again.");
      }
    } catch (err) {
      console.error("🚨 Error validating credentials:", err);
      setError(err.message || "An error occurred while validating credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h1>Login</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "20px" }}>
          <label style={{ marginRight: "10px" }}>Email:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())} // Trim whitespace
            required
            style={{
              padding: "8px",
              borderRadius: "5px",
              border: "1px solid #ccc",
            }}
          />
        </div>
        <div style={{ marginBottom: "20px" }}>
          <label style={{ marginRight: "10px" }}>Unique Key:</label>
          <input
            type="text"
            value={uniqueKey}
            onChange={(e) => setUniqueKey(e.target.value.trim())} // Trim whitespace
            required
            style={{
              padding: "8px",
              borderRadius: "5px",
              border: "1px solid #ccc",
            }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 20px",
            fontSize: "16px",
            borderRadius: "10px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            cursor: "pointer",
          }}
        >
          {loading ? "Validating..." : "Submit"}
        </button>
      </form>
    </div>
  );
}

export default App;