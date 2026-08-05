const API = "https://vic-momo.onrender.com";

async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
        const response = await fetch(`${API}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.detail || "Login failed");
            return;
        }

        localStorage.setItem("token", data.access_token);

        openWallet();

    } catch (error) {
        alert("Server connection problem. Please try again.");
    }
}


function openWallet() {
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("walletBox").style.display = "block";

    document.getElementById("balance").innerText =
        "Welcome to Zelix Wallet";
}


window.onload = function () {
    const token = localStorage.getItem("token");

    if (token) {
        openWallet();
    }
};
