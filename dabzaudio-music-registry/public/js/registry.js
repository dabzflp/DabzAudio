const form = document.getElementById("registrationForm");
const audioInput = document.getElementById("audio");
const chooseFile = document.getElementById("chooseFile");
const uploadZone = document.getElementById("uploadZone");
const fileLabel = document.getElementById("fileLabel");
const registerButton = document.getElementById("registerButton");
const resultPanel = document.getElementById("result");

chooseFile.addEventListener("click", function () {
    audioInput.click();
});

audioInput.addEventListener("change", function () {
    updateFileLabel(audioInput.files[0]);
});

["dragenter", "dragover"].forEach(function (eventName) {
    uploadZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        uploadZone.classList.add("dragging");
    });
});

["dragleave", "drop"].forEach(function (eventName) {
    uploadZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        uploadZone.classList.remove("dragging");
    });
});

uploadZone.addEventListener("drop", function (event) {
    const file = event.dataTransfer.files[0];

    if (!file) {
        return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    audioInput.files = transfer.files;

    updateFileLabel(file);
});

form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const file = audioInput.files[0];

    if (!file) {
        showResult("error", "Please choose an audio file.");
        return;
    }

    registerButton.disabled = true;
    registerButton.querySelector("span").textContent = "Fingerprinting + registering...";

    try {
        const formData = new FormData(form);

        const response = await fetch("/api/registry/register", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Registration failed.");
        }

        const music = data.music;
        const verificationUrl = `${window.location.origin}/music-id/${music.musicId}`;

        showResult(
            "success",
            `
                <p class="eyebrow">REGISTRATION COMPLETE</p>
                <h3>Your Music ID is live.</h3>
                <div class="result-id">${escapeHtml(music.musicId)}</div>
                <p class="microcopy">
                    Audio fingerprint created: ${escapeHtml(music.audioHash.slice(0, 24))}…
                </p>
                <p>
                    <a class="result-link" href="${verificationUrl}" target="_blank" rel="noopener">
                        Open public verification page →
                    </a>
                </p>
            `
        );

        form.reset();
        fileLabel.textContent = "Drop your master here";
    } catch (error) {
        showResult("error", `<strong>Registration failed.</strong><br>${escapeHtml(error.message)}`);
    } finally {
        registerButton.disabled = false;
        registerButton.querySelector("span").textContent = "Register Music ID";
    }
});

function updateFileLabel(file) {
    if (!file) {
        return;
    }

    fileLabel.textContent = file.name;
}

function showResult(type, content) {
    resultPanel.classList.remove("hidden");
    resultPanel.innerHTML = content;

    if (type === "error") {
        resultPanel.style.borderColor = "rgba(255, 95, 122, 0.3)";
        resultPanel.style.background = "rgba(255, 95, 122, 0.04)";
    } else {
        resultPanel.style.borderColor = "rgba(140, 255, 66, 0.2)";
        resultPanel.style.background = "rgba(140, 255, 66, 0.04)";
    }

    resultPanel.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
