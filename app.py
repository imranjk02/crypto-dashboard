import os
import secrets
import mysql.connector
import requests
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from werkzeug.security import generate_password_hash, check_password_hash


app = Flask(__name__)

app.secret_key = os.getenv("SECRET_KEY")


DB_CONFIG = {
    "host": os.getenv("MYSQLHOST"),
    "port": int(os.getenv("MYSQLPORT", "3306")),
    "user": os.getenv("MYSQLUSER"),
    "password": os.getenv("MYSQLPASSWORD"),
    "database": os.getenv("MYSQLDATABASE", "cryptodash"),
    "ssl_disabled": False
}


COINGECKO = "https://api.coingecko.com/api/v3"


def get_db():
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        print("MYSQL CONNECTED SUCCESSFULLY")
        return conn
    except mysql.connector.Error as e:
        print("MYSQL ERROR:", e)
        return None


def init_db():
    conn = get_db()

    if not conn:
        print("DATABASE INITIALIZATION FAILED")
        return

    try:
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                theme VARCHAR(20) DEFAULT 'dark',
                currency VARCHAR(10) DEFAULT 'usd',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS watchlist (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                coin_id VARCHAR(100) NOT NULL,
                UNIQUE KEY unique_watch (user_id, coin_id),
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS portfolio (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                coin_id VARCHAR(100) NOT NULL,
                quantity DECIMAL(30,10) NOT NULL,
                buy_price DECIMAL(30,10) NOT NULL,
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS password_resets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
            )
        """)

        conn.commit()

        print("DATABASE TABLES READY")

        cur.close()
        conn.close()

    except mysql.connector.Error as e:
        print("DATABASE INITIALIZATION ERROR:", e)
        conn.close()


def login_required():
    return "user_id" in session


def current_user():
    if not login_required():
        return None

    conn = get_db()

    if not conn:
        return None

    try:
        cur = conn.cursor(dictionary=True)

        cur.execute(
            """
            SELECT id, name, email, theme, currency
            FROM users
            WHERE id = %s
            """,
            (session["user_id"],)
        )

        user = cur.fetchone()

        cur.close()
        conn.close()

        return user

    except mysql.connector.Error as e:
        print("CURRENT USER ERROR:", e)
        conn.close()
        return None


def get_market_data(ids=None, per_page=20):
    params = {
        "vs_currency": "usd",
        "order": "market_cap_desc",
        "per_page": per_page,
        "page": 1,
        "sparkline": "false",
        "price_change_percentage": "24h"
    }

    if ids:
        params["ids"] = ",".join(ids)

    for attempt in range(3):
        try:
            response = requests.get(
                f"{COINGECKO}/coins/markets",
                params=params,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "CryptoDash/1.0"
                },
                timeout=20
            )

            print("COINGECKO STATUS:", response.status_code)

            if response.status_code == 200:
                data = response.json()
                print("COINS RECEIVED:", len(data))
                return data

            print("COINGECKO RESPONSE:", response.text[:300])

            if response.status_code in (429, 500, 502, 503, 504):
                import time
                time.sleep(2 * (attempt + 1))
                continue

            response.raise_for_status()

        except requests.RequestException as e:
            print("COINGECKO ERROR:", e)

            if attempt < 2:
                import time
                time.sleep(2 * (attempt + 1))
            else:
                return None

    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "POST":

        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        conn = get_db()

        if not conn:
            return "MySQL connection failed. Check your MySQL settings.", 500

        try:
            cur = conn.cursor(dictionary=True)

            cur.execute(
                "SELECT * FROM users WHERE email = %s",
                (email,)
            )

            user = cur.fetchone()

            cur.close()
            conn.close()

            if user and check_password_hash(user["password"], password):

                session["user_id"] = user["id"]

                print("LOGIN SUCCESS:", email)

                return redirect(url_for("dashboard"))

            print("LOGIN FAILED:", email)

            return "Invalid email or password.", 401

        except mysql.connector.Error as e:

            print("LOGIN MYSQL ERROR:", e)

            conn.close()

            return f"MySQL Error: {e}", 500

    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():

    if request.method == "POST":

        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")

        if not name:
            return "Name is required.", 400

        if not email:
            return "Email is required.", 400

        if password != confirm:
            return "Passwords do not match.", 400

        if len(password) < 6:
            return "Password must contain at least 6 characters.", 400

        conn = get_db()

        if not conn:
            return "MySQL connection failed. Check your MySQL settings.", 500

        try:

            cur = conn.cursor()

            hashed_password = generate_password_hash(password)

            cur.execute(
                """
                INSERT INTO users
                (name, email, password)
                VALUES (%s, %s, %s)
                """,
                (name, email, hashed_password)
            )

            conn.commit()

            print("USER SAVED:", email)

            cur.close()
            conn.close()

            return redirect(url_for("login"))

        except mysql.connector.IntegrityError:

            conn.close()

            return "This email is already registered.", 400

        except mysql.connector.Error as e:

            print("SIGNUP MYSQL ERROR:", e)

            conn.close()

            return f"MySQL Error: {e}", 500

    return render_template("signup.html")


@app.route("/logout")
def logout():

    session.clear()

    return redirect(url_for("index"))


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "GET":
        return render_template("forgot-password.html")

    email = request.form.get("email", "").strip().lower()

    if not email:
        flash("Please enter your email address.", "error")
        return redirect("/forgot-password")

    conn = get_db()

    if not conn:
        flash("Database connection failed.", "error")
        return redirect("/forgot-password")

    try:
        cursor = conn.cursor(dictionary=True)

        cursor.execute(
            "SELECT id, email FROM users WHERE email = %s",
            (email,)
        )

        user = cursor.fetchone()

        if not user:
            flash("No account found with this email.", "error")
            return redirect("/forgot-password")

        token = secrets.token_urlsafe(32)

        expires_at = datetime.now() + timedelta(minutes=30)

        cursor.execute(
            "INSERT INTO password_resets (user_id, token, expires_at) VALUES (%s, %s, %s)",
            (user["id"], token, expires_at)
        )

        conn.commit()

        reset_url = url_for(
            "reset_password",
            token=token,
            _external=True
        )

        flash(
            f"Reset link created: {reset_url}",
            "success"
        )

        return redirect("/login")

    except Exception as e:
        print("FORGOT PASSWORD ERROR:", e)
        flash("Something went wrong. Please try again.", "error")
        return redirect("/forgot-password")

    finally:
        try:
            cursor.close()
            conn.close()
        except:
            pass

@app.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token):

    conn = get_db()

    if not conn:
        return "Database connection failed.", 500

    try:

        cur = conn.cursor(dictionary=True)

        cur.execute(
            """
            SELECT *
            FROM password_resets
            WHERE token = %s
            AND expires_at > NOW()
            """,
            (token,)
        )

        reset = cur.fetchone()

        if not reset:

            cur.close()
            conn.close()

            return "Invalid or expired reset link.", 400

        if request.method == "POST":

            password = request.form.get("password", "")
            confirm = request.form.get("confirm_password", "")

            if password != confirm:
                cur.close()
                conn.close()
                return "Passwords do not match.", 400

            if len(password) < 6:
                cur.close()
                conn.close()
                return "Password must contain at least 6 characters.", 400

            cur.execute(
                """
                UPDATE users
                SET password = %s
                WHERE id = %s
                """,
                (
                    generate_password_hash(password),
                    reset["user_id"]
                )
            )

            cur.execute(
                """
                DELETE FROM password_resets
                WHERE id = %s
                """,
                (reset["id"],)
            )

            conn.commit()

            cur.close()
            conn.close()

            return redirect(url_for("login"))

        cur.close()
        conn.close()

        return render_template("reset-password.html")

    except mysql.connector.Error as e:

        print("RESET PASSWORD ERROR:", e)

        conn.close()

        return f"MySQL Error: {e}", 500


@app.route("/dashboard")
def dashboard():

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "dashboard.html",
        user=current_user()
    )


@app.route("/crypto")
def crypto():

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "crypto.html",
        user=current_user()
    )


@app.route("/coin/<coin_id>")
def coin_details(coin_id):

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "coin-details.html",
        user=current_user(),
        coin_id=coin_id
    )


@app.route("/watchlist")
def watchlist():

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "watchlist.html",
        user=current_user()
    )


@app.route("/portfolio")
def portfolio():

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "portfolio.html",
        user=current_user()
    )


@app.route("/profile")
def profile():

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "profile.html",
        user=current_user()
    )


@app.route("/settings")
def settings():

    if not login_required():
        return redirect(url_for("login"))

    return render_template(
        "settings.html",
        user=current_user()
    )


@app.route("/api/market")
def api_market():

    data = get_market_data(per_page=50)

    if data is None:

        return jsonify({
            "error": "Unable to load market data from CoinGecko."
        }), 502

    return jsonify(data)


@app.route("/api/coin/<coin_id>")
def api_coin(coin_id):

    try:

        response = requests.get(
            f"{COINGECKO}/coins/{coin_id}",
            params={
                "localization": "false",
                "tickers": "false",
                "market_data": "true",
                "community_data": "false",
                "developer_data": "false"
            },
            headers={
                "Accept": "application/json",
                "User-Agent": "CryptoDash/1.0"
            },
            timeout=20
        )

        print(
            "COIN API:",
            coin_id,
            response.status_code
        )

        response.raise_for_status()

        return jsonify(response.json())

    except requests.RequestException as e:

        print("COIN API ERROR:", e)

        return jsonify({
            "error": "Unable to load coin data."
        }), 502


@app.route("/api/coin/<coin_id>/chart")
def api_coin_chart(coin_id):

    days = request.args.get("days", "30")

    allowed_days = {
        "1",
        "7",
        "30",
        "90",
        "365"
    }

    if days not in allowed_days:
        days = "30"

    try:

        response = requests.get(
            f"{COINGECKO}/coins/{coin_id}/market_chart",
            params={
                "vs_currency": "usd",
                "days": days
            },
            headers={
                "Accept": "application/json",
                "User-Agent": "CryptoDash/1.0"
            },
            timeout=20
        )

        print(
            "CHART API:",
            coin_id,
            days,
            response.status_code
        )

        response.raise_for_status()

        return jsonify(response.json())

    except requests.RequestException as e:

        print("CHART API ERROR:", e)

        return jsonify({
            "error": "Unable to load chart."
        }), 502


@app.route("/api/watchlist", methods=["GET", "POST", "DELETE"])
def api_watchlist():

    if not login_required():

        return jsonify({
            "error": "Unauthorized"
        }), 401

    conn = get_db()

    if not conn:

        return jsonify({
            "error": "Database connection failed"
        }), 500

    try:

        cur = conn.cursor(dictionary=True)

        if request.method == "GET":

            cur.execute(
                """
                SELECT id, coin_id
                FROM watchlist
                WHERE user_id = %s
                """,
                (session["user_id"],)
            )

            data = cur.fetchall()

            cur.close()
            conn.close()

            return jsonify(data)

        data = request.get_json(silent=True) or {}

        coin_id = str(
            data.get("coin_id", "")
        ).strip().lower()

        if not coin_id:

            cur.close()
            conn.close()

            return jsonify({
                "error": "Coin ID required"
            }), 400

        if request.method == "POST":

            cur.execute(
                """
                INSERT IGNORE INTO watchlist
                (user_id, coin_id)
                VALUES (%s, %s)
                """,
                (
                    session["user_id"],
                    coin_id
                )
            )

        else:

            cur.execute(
                """
                DELETE FROM watchlist
                WHERE user_id = %s
                AND coin_id = %s
                """,
                (
                    session["user_id"],
                    coin_id
                )
            )

        conn.commit()

        cur.close()
        conn.close()

        return jsonify({
            "success": True
        })

    except mysql.connector.Error as e:

        print("WATCHLIST ERROR:", e)

        conn.close()

        return jsonify({
            "error": str(e)
        }), 500


@app.route("/api/portfolio", methods=["GET", "POST", "DELETE"])
def api_portfolio():

    if not login_required():

        return jsonify({
            "error": "Unauthorized"
        }), 401

    conn = get_db()

    if not conn:

        return jsonify({
            "error": "Database connection failed"
        }), 500

    try:

        cur = conn.cursor(dictionary=True)

        if request.method == "GET":

            cur.execute(
                """
                SELECT id, coin_id, quantity, buy_price
                FROM portfolio
                WHERE user_id = %s
                """,
                (session["user_id"],)
            )

            data = cur.fetchall()

            cur.close()
            conn.close()

            return jsonify(data)

        data = request.get_json(silent=True) or {}

        if request.method == "DELETE":

            item_id = data.get("id")

            cur.execute(
                """
                DELETE FROM portfolio
                WHERE id = %s
                AND user_id = %s
                """,
                (
                    item_id,
                    session["user_id"]
                )
            )

        else:

            coin_id = str(
                data.get("coin_id", "")
            ).strip().lower()

            try:
                quantity = float(
                    data.get("quantity", 0)
                )

                buy_price = float(
                    data.get("buy_price", 0)
                )

            except (TypeError, ValueError):

                cur.close()
                conn.close()

                return jsonify({
                    "error": "Invalid quantity or price"
                }), 400

            if (
                not coin_id
                or quantity <= 0
                or buy_price < 0
            ):

                cur.close()
                conn.close()

                return jsonify({
                    "error": "Invalid portfolio data"
                }), 400

            cur.execute(
                """
                INSERT INTO portfolio
                (user_id, coin_id, quantity, buy_price)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    session["user_id"],
                    coin_id,
                    quantity,
                    buy_price
                )
            )

        conn.commit()

        cur.close()
        conn.close()

        return jsonify({
            "success": True
        })

    except mysql.connector.Error as e:

        print("PORTFOLIO ERROR:", e)

        conn.close()

        return jsonify({
            "error": str(e)
        }), 500


@app.route("/api/profile", methods=["GET", "PUT"])
def api_profile():

    if not login_required():

        return jsonify({
            "error": "Unauthorized"
        }), 401

    conn = get_db()

    if not conn:

        return jsonify({
            "error": "Database connection failed"
        }), 500

    try:

        cur = conn.cursor(dictionary=True)

        if request.method == "GET":

            cur.execute(
                """
                SELECT id, name, email, theme, currency
                FROM users
                WHERE id = %s
                """,
                (session["user_id"],)
            )

            data = cur.fetchone()

        else:

            data = request.get_json(
                silent=True
            ) or {}

            name = str(
                data.get("name", "")
            ).strip()

            email = str(
                data.get("email", "")
            ).strip().lower()

            if not name or not email:

                cur.close()
                conn.close()

                return jsonify({
                    "error": "Name and email are required"
                }), 400

            cur.execute(
                """
                UPDATE users
                SET name = %s, email = %s
                WHERE id = %s
                """,
                (
                    name,
                    email,
                    session["user_id"]
                )
            )

            conn.commit()

            cur.execute(
                """
                SELECT id, name, email, theme, currency
                FROM users
                WHERE id = %s
                """,
                (session["user_id"],)
            )

            data = cur.fetchone()

        cur.close()
        conn.close()

        return jsonify(data)

    except mysql.connector.IntegrityError:

        conn.close()

        return jsonify({
            "error": "Email is already registered"
        }), 400

    except mysql.connector.Error as e:

        print("PROFILE ERROR:", e)

        conn.close()

        return jsonify({
            "error": str(e)
        }), 500


@app.route("/api/password", methods=["POST"])
def api_password():

    if not login_required():

        return jsonify({
            "error": "Unauthorized"
        }), 401

    data = request.get_json(
        silent=True
    ) or {}

    current_password = data.get(
        "current_password",
        ""
    )

    new_password = data.get(
        "new_password",
        ""
    )

    confirm_password = data.get(
        "confirm_password",
        ""
    )

    conn = get_db()

    if not conn:

        return jsonify({
            "error": "Database connection failed"
        }), 500

    try:

        cur = conn.cursor(dictionary=True)

        cur.execute(
            """
            SELECT password
            FROM users
            WHERE id = %s
            """,
            (session["user_id"],)
        )

        user = cur.fetchone()

        if (
            not user
            or not check_password_hash(
                user["password"],
                current_password
            )
        ):

            cur.close()
            conn.close()

            return jsonify({
                "error": "Current password is incorrect"
            }), 400

        if len(new_password) < 6:

            cur.close()
            conn.close()

            return jsonify({
                "error": "New password must contain at least 6 characters"
            }), 400

        if new_password != confirm_password:

            cur.close()
            conn.close()

            return jsonify({
                "error": "Passwords do not match"
            }), 400

        cur.execute(
            """
            UPDATE users
            SET password = %s
            WHERE id = %s
            """,
            (
                generate_password_hash(new_password),
                session["user_id"]
            )
        )

        conn.commit()

        cur.close()
        conn.close()

        return jsonify({
            "success": True
        })

    except mysql.connector.Error as e:

        print("PASSWORD ERROR:", e)

        conn.close()

        return jsonify({
            "error": str(e)
        }), 500


@app.route("/api/settings", methods=["GET", "PUT"])
def api_settings():

    if not login_required():

        return jsonify({
            "error": "Unauthorized"
        }), 401

    conn = get_db()

    if not conn:

        return jsonify({
            "error": "Database connection failed"
        }), 500

    try:

        cur = conn.cursor(dictionary=True)

        if request.method == "PUT":

            data = request.get_json(
                silent=True
            ) or {}

            theme = data.get(
                "theme",
                "dark"
            )

            currency = data.get(
                "currency",
                "usd"
            )

            if theme not in ["dark", "light"]:
                theme = "dark"

            if currency not in ["usd", "inr", "eur", "gbp"]:
                currency = "usd"

            cur.execute(
                """
                UPDATE users
                SET theme = %s, currency = %s
                WHERE id = %s
                """,
                (
                    theme,
                    currency,
                    session["user_id"]
                )
            )

            conn.commit()

        cur.execute(
            """
            SELECT theme, currency
            FROM users
            WHERE id = %s
            """,
            (session["user_id"],)
        )

        data = cur.fetchone()

        cur.close()
        conn.close()

        return jsonify(data)

    except mysql.connector.Error as e:

        print("SETTINGS ERROR:", e)

        conn.close()

        return jsonify({
            "error": str(e)
        }), 500


if __name__ == "__main__":

    print("=" * 50)
    print("CRYPTODASH STARTING")
    print("=" * 50)

    print("MYSQL HOST:", DB_CONFIG["host"])
    print("MYSQL PORT:", DB_CONFIG["port"])
    print("MYSQL USER:", DB_CONFIG["user"])
    print("MYSQL DATABASE:", DB_CONFIG["database"])

    init_db()

    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=True
    )