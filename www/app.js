const API = "http://127.0.0.1:8000";

let token = localStorage.getItem("token");
let currentUser = null;


async function login() {

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;


    const response = await fetch(
        `${API}/auth/login?email=${email}&password=${password}`,
        {
            method: "POST"
        }
    );


    const data = await response.json();


    if (data.access_token) {
    localStorage.setItem(
        "token",
    data.access_token
);
        token = data.access_token;

        document.getElementById("loginBox").style.display = "none";
        document.getElementById("chatBox").style.display = "block";

        alert("Login successful");

    } else {

        alert("Login failed");

    }

}



async function sendMessage() {

    const receiver =
        document.getElementById("receiver").value;

    const text =
        document.getElementById("message").value;


    const response = await fetch(
        `${API}/chat/send?sender_id=1&receiver_id=${receiver}&text=${text}`,
        {
            method: "POST"
        }
    );


    const data = await response.json();


    document.getElementById("messages").innerHTML +=
        `<p>${data.message}</p>`;

}
