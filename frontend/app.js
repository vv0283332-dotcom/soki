const API = "https://vic-momo.onrender.com";

async function login() {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        const response = await fetch(API + "/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (data.access_token) {
            localStorage.setItem("token", data.access_token);

            document.getElementById("loginBox").style.display = "none";
            document.getElementById("walletBox").style.display = "block";

            document.getElementById("balance").innerText =
                "Welcome to Zelix Wallet";
        } else {
            alert(data.detail || "Login failed");
        }

    } catch (error) {
        alert("Connection error");
    }
}
