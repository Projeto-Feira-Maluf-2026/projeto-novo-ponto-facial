import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;

class ApiClient {
  ApiClient({this.baseUrl = 'http://10.0.2.2:8000/api/v1'});

  final String baseUrl;
  String? accessToken;

  Future<bool> isOnline() async {
    final result = await Connectivity().checkConnectivity();
    return !result.contains(ConnectivityResult.none);
  }

  Future<bool> punch(Map<String, dynamic> payload) async {
    final response = await http.post(
      Uri.parse('$baseUrl/attendance/punch'),
      headers: {
        'Content-Type': 'application/json',
        if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      },
      body: jsonEncode(payload),
    );
    if (response.statusCode >= 500) {
      throw Exception('API indisponivel');
    }
    if (response.statusCode == 401 || response.statusCode == 403) {
      return false;
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['accepted'] == true;
  }
}

