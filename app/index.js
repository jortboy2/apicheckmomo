const { default: axios } = require("axios");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const serviceAccount = require("../config/momo-887f3-firebase-adminsdk-684bp-4cee6b624a.json"); // Đường dẫn tới file JSON

// Khởi tạo Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json());
const PORT = 4000;
const baseUrl = "https://business.momo.vn";

async function loginMomo(phone) {
  try {
    const response_login = await axios.post(
      `${baseUrl}/api/authentication/login?language=vi`,
      { password: "Andanh@15", username: phone },
      { responseType: "arraybuffer" }
    );

    const decodedData = new TextDecoder("utf-8").decode(response_login.data);
    const responseData = JSON.parse(decodedData);

    return {
      phone,
      status: "Thành công",
      token: responseData.data?.token || null,
      message: responseData.message || "Đăng nhập thành công",
    };
  } catch (error) {
    return {
      phone,
      status: "Thất bại",
      token: null,
      message: error.response?.data || "Lỗi đăng nhập",
    };
  }
}

async function getMerchant(login) {
  if (!login.token) {
    return { phone: login.phone, data: null, status: "Đăng nhập thất bại" };
  }

  try {
    const response_mechant = await axios.get(
      `${baseUrl}/api/profile/v2/merchants?requestType=LOGIN_MERCHANTS&language=vi`,
      { headers: { Authorization: `Bearer ${login.token}` } }
    );

    const merchants = response_mechant.data.data.merchantResponseList || [];

    return {
      phone: login.phone,
      data: merchants,
      status: merchants.length
        ? "Lấy merchant thành công"
        : "Không tìm thấy merchant",
    };
  } catch (error) {
    return { phone: login.phone, data: null, status: "Lấy merchant thất bại" };
  }
}

app.post("/get-history", async (req, res) => {
  const { phone, fromDate, toDate } = req.body;

  if (!Array.isArray(phone)) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ.",
    });
  }
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().split(".")[0];
  };
  const formattedFromDate = fromDate
    ? formatDate(fromDate)
    : "2025-03-01T00:00:00";
  const formattedToDate = toDate ? formatDate(toDate) : "2025-03-12T23:59:59";

  try {
    const results = await Promise.all(phone.map(loginMomo));
    const merchants = await Promise.all(results.map(getMerchant));

    const result_history = await Promise.all(
      merchants.map(async (merchant) => {
        const merchantData = merchant.data?.[0]?.id;
        const token = results.find((r) => r.phone === merchant.phone)?.token;

        if (!merchantData || !token) {
          return {
            phone: merchant.phone,
            data: null,
            status: merchantData
              ? "Không tìm thấy token"
              : "Không tìm thấy merchant",
          };
        }

        try {
          const response_history = await axios.get(
            `${baseUrl}/api/transaction/v2/transactions/statistics?pageSize=20&pageNumber=0&fromDate=${encodeURIComponent(
              formattedFromDate
            )}&toDate=${encodeURIComponent(
              formattedToDate
            )}&dateId=THIS_MONTH&reportId=0&merchantId=${merchantData}&language=vi`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          return {
            phone: merchant.phone,
            shop: merchant.data[0].brandName,
            pendingMoney: response_history.data.data.totalPendingTrans,
            totalMoney: response_history.data.data.totalSuccessAmount,
            status: "Lấy lịch sử giao dịch thành công",
            merchantId: merchant.data[0].id,
            token: token,
          };
        } catch (error) {
          return {
            phone: merchant.phone,
            shop: merchant.data[0].brandName,
            totalMoney: null,
            pendingMoney: null,
            status: "Lấy lịch sử giao dịch thất bại, hãy thử lại",
            merchantId: merchant.data[0].id,
            token: token,
            error: error.message || "Lỗi không xác định",
          };
        }
      })
    );
    // kiểm trả paylater
    const result_paylater = await Promise.all(
      result_history.map(async (paylater_history) => {
        const merchantData = paylater_history.merchantId;
        const token = results.find(
          (r) => r.phone === paylater_history.phone
        )?.token;

        if (!paylater_history || !token) {
          return {
            phone: paylater_history.phone,
            data: null,
            status: merchantData
              ? "Không tìm thấy token"
              : "Không tìm thấy merchant",
          };
        }

        try {
          const response_paylater = await axios.get(
            `${baseUrl}/api/profile/v2/merchants/${paylater_history.merchantId}/paylater?language=vi`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          return {
            phone: paylater_history.phone,
            shop: paylater_history.shop,
            pendingMoney: paylater_history.pendingMoney,
            totalMoney: paylater_history.totalMoney,
            status: paylater_history.status,
            merchantId: paylater_history.merchantId,
            paylater: response_paylater.data.data.enabled,
            // limit: ((paylater_history.totalMoney / response_paylater.data.data.limit) * 100).toFixed(2)
          };
        } catch (error) {
          return {
            phone: paylater_history.phone,
            shop: paylater_history.shop,
            pendingMoney: paylater_history.pendingMoney,
            totalMoney: paylater_history.totalMoney,
            status: paylater_history.status,
            merchantId: paylater_history.merchantId,
            paylater: null,
            error: error.message || "Lỗi không xác định",
            // limit: null

          };
        }
      })
    );

    res.json({ result_paylater });
  } catch (error) {
    console.error("Lỗi hệ thống:", error);
    res.status(500).json({ error: "Có lỗi xảy ra trong quá trình xử lý." });
  }
});
app.post("/paylater-disable", async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ. Vui lòng gửi số điện thoại hợp lệ.",
    });
  }

  try {
    const result = await loginMomo(phone);
    const merchant = await getMerchant(result);

    const merchantId = merchant?.data?.[0]?.id;
    const token = result?.token;

    if (!merchantId || !token) {
      return res.status(400).json({
        phone,
        status: merchantId ? "Không tìm thấy token" : "Không tìm thấy merchant",
      });
    }

    const payload = {
      enabled: false,
      note: "Doanh nghiệp dừng hoạt động",
    };

    try {
      const paylater = await axios.post(
        `${baseUrl}/api/profile/v2/merchants/${merchantId}/paylater/status?language=vi`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      res.json({
        phone,
        status: "Hủy ví trả sau thành công",
        message: paylater.data,
      });
    } catch (error) {
      res.status(500).json({
        phone,
        status:
          "Lỗi khi hủy ví trả sau: " +
          (error.response?.data?.message || error.message),
      });
    }
  } catch (error) {
    console.error("Lỗi hệ thống:", error);
    res.status(500).json({ error: "Có lỗi xảy ra trong quá trình xử lý." });
  }
});

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    await db.collection("user").add({
      email: email,
      password: password,
    });
    res.status(201).json({ message: "Thêm user thành công" });
  } catch (error) {
    console.log("Error: " + error);
    res.status(500).json({ error: "Có lỗi xảy ra trong quá trình xử lý." });
  }
});
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const snapshot = await db
      .collection("user")
      .where("email", "==", email)
      .where("password", "==", password)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng." });
    }

    const userDoc = snapshot.docs[0]; // Lấy user đầu tiên khớp với email & password
    const userId = userDoc.id; // Lấy ID từ document

    res.status(200).json({ message: "Đăng nhập thành công!", userId: userId });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Có lỗi xảy ra trong quá trình xử lý." });
  }
});

app.post("/save-phone", async (req, res) => {
  const { userId, phone } = req.body;

  if (!userId || !phone) {
    return res.status(400).json({ error: "Vui lòng cung cấp userId và số điện thoại." });
  }

  try {
    await db.collection(`data-phone-${userId}`).add({
      userId: userId,
      phone: phone
    });

    res.status(201).json({ message: "Lưu số điện thoại thành công!" });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Có lỗi xảy ra trong quá trình xử lý." });
  }
});
app.listen(PORT, () => {
  console.log(`Đang lắng nghe PORT http://localhost:${PORT}`);
});
// https://business.momo.vn/api/profile/v2/merchants/1930506/paylater/status?language=vi
// {
//   "enabled": false,
//   "note": "Doanh nghiệp dừng hoạt động"
// }
