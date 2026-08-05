const API = "https://vic-momo.onrender.com";

async function login() {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);

    const response = await fetch(API + "/auth/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form
    });

    const data = await response.json();

    if (data.access_token) {
        localStorage.setItem("token", data.access_token);
        alert("Login successful");
    } else {
        alert(JSON.stringify(data));
    }
}
