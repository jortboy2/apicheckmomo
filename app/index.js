const { default: axios } = require("axios");
const express = require("express");
const cors = require("cors");

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
app.post("/check-accountmomo", async (req, res) => {
  const { phone } = req.body;

  if (!Array.isArray(phone) || phone.length === 0) {
    return res.status(400).json({
      error: "Dữ liệu không hợp lệ.",
    });
  }

  const responses = [];

  for (const userId of phone) {
    const cmdId = `${Date.now()}${Math.floor(100000000000 + Math.random() * 900000000000)}`;
    const timestamp = Date.now();

    const payload = {
      userId: userId,
      msgType: "AUTH_USER_MSG",
      cmdId: cmdId,
      time: timestamp,
      appVer: 42020,
      appCode: "4.2.2",
      deviceOS: "ios",
      buildNumber: 42020,
      imei: "41221-9f9783040032ab267e49bd5ff7269b50dd4a19b6835ddc805103a3f1bf1a2058",
      device: "iPhone 12 Pro Max",
      firmware: "17.6.1",
      hardware: "iPhone",
      rkey: "87cdf85297a507bf7faa958ac9b04f3d",
      isNFCAvailable: true
    };

    try {
      const response = await axios.post("https://api.momo.vn/public/auth/user/check", payload);
      if (response.data.errorCode === -3) {
        responses.push({ userId: userId, valid: false });
      } else {
        responses.push({ userId: userId, valid: true });
      }
    } catch (error) {
      responses.push({
        userId: userId,
        error: "Có lỗi xảy ra khi gọi API kiểm tra người dùng: " + (error.response?.data?.message || error.message),
      });
    }
  }

  res.json(responses);
});
app.listen(PORT, () => {
  console.log(`Đang lắng nghe PORT http://localhost:${PORT}`);
});
// https://business.momo.vn/api/profile/v2/merchants/1930506/paylater/status?language=vi
// {
//   "enabled": false,
//   "note": "Doanh nghiệp dừng hoạt động"
// }
